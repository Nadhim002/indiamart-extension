// One-off test for the purchase circuit-breaker (getPurchaseGate /
// recordPurchaseOutcome in src/background/service-worker.js) and the
// per-lead attempt cap applied inside injectedFetchAndBuy. No test runner is
// configured in this repo (see scripts/backfill-lead-ids.js for the same
// plain-node-script convention).
//
// Re-implements the storage-backed logic against an in-memory fake of
// chrome.storage.local so the real timing/threshold constants stay in sync
// with the worker by literal copy — keep this file in sync if those change.
//
// Run: node scripts/test-purchase-breaker.mjs

const BREAKER_TRIP_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_LEAD = 3;

function makeStore(now) {
  const data = {};
  return {
    get: async (keys) => Object.fromEntries(keys.map((k) => [k, data[k]])),
    set: async (values) => Object.assign(data, values),
    _raw: data,
    _now: () => now.value,
  };
}

function todayIso(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

async function getPurchaseGate(store, nowMs) {
  const { purchaseBreaker, purchaseAttempts } = await store.get(['purchaseBreaker', 'purchaseAttempts']);
  const today = todayIso(nowMs);
  const attemptCounts =
    purchaseAttempts && purchaseAttempts.date === today ? purchaseAttempts.ids || {} : {};

  if (!purchaseBreaker?.tripped) {
    return { attemptCounts, allowAttempts: true, probeOnly: false };
  }
  const elapsed = purchaseBreaker.lastAttemptAt ? nowMs - purchaseBreaker.lastAttemptAt : Infinity;
  if (elapsed < BREAKER_COOLDOWN_MS) {
    return { attemptCounts, allowAttempts: false, probeOnly: false };
  }
  return { attemptCounts, allowAttempts: true, probeOnly: true };
}

async function recordPurchaseOutcome(store, nowMs, { succeededIds = [], failedIds = [], attemptedIds = [] }) {
  if (failedIds.length > 0) {
    const today = todayIso(nowMs);
    const { purchaseAttempts } = await store.get(['purchaseAttempts']);
    const ids = purchaseAttempts && purchaseAttempts.date === today ? { ...purchaseAttempts.ids } : {};
    for (const id of failedIds) ids[String(id)] = (ids[String(id)] || 0) + 1;
    await store.set({ purchaseAttempts: { date: today, ids } });
  }

  if (attemptedIds.length === 0) return;

  if (succeededIds.length > 0) {
    await store.set({ purchaseBreaker: { tripped: false, failedIds: [], trippedAt: null, lastAttemptAt: nowMs } });
    return;
  }
  if (failedIds.length === 0) return;

  const { purchaseBreaker } = await store.get(['purchaseBreaker']);
  const merged = new Set((purchaseBreaker?.failedIds || []).map(String));
  for (const id of failedIds) merged.add(String(id));
  const tripped = purchaseBreaker?.tripped || merged.size >= BREAKER_TRIP_THRESHOLD;
  await store.set({
    purchaseBreaker: {
      tripped,
      failedIds: [...merged],
      trippedAt: tripped ? purchaseBreaker?.trippedAt || nowMs : null,
      lastAttemptAt: nowMs,
    },
  });
}

// Simulates one tick: leadIds are the matched candidates before the gate,
// each tagged 'ok' or 'fail'. Returns what the worker would see.
async function tick(store, now, leadIds, outcome) {
  const gate = await getPurchaseGate(store, now.value);
  let candidates = leadIds.filter((id) => (gate.attemptCounts[id] || 0) < MAX_ATTEMPTS_PER_LEAD);
  let attempted = candidates;
  if (!gate.allowAttempts) attempted = [];
  else if (gate.probeOnly) attempted = candidates.slice(0, 1);

  const succeededIds = attempted.filter((id) => outcome(id) === 'ok');
  const failedIds = attempted.filter((id) => outcome(id) === 'fail');
  await recordPurchaseOutcome(store, now.value, { succeededIds, failedIds, attemptedIds: attempted });
  return { attempted, succeededIds, failedIds, gate };
}

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) {
    failures++;
    if (detail) console.log('  ', detail);
  }
}

// --- Test 1: breaker trips after 5 distinct failing leads, then gates ---
{
  const now = { value: Date.parse('2026-09-05T06:00:00Z') };
  const store = makeStore(now);
  const outcome = () => 'fail';

  let r;
  for (let i = 0; i < 5; i++) {
    r = await tick(store, now, [`lead-${i}`], outcome);
    now.value += 3200; // one 3.2s tick
  }
  check('breaker trips exactly at the 5th distinct failure', store._raw.purchaseBreaker.tripped === true);

  // Next tick, still within cooldown — must NOT call contactBuyNow at all.
  r = await tick(store, now, ['lead-99'], outcome);
  check('tripped + within cooldown blocks all attempts', r.attempted.length === 0, r);

  // Jump past the cooldown — exactly one probe lead allowed.
  now.value += BREAKER_COOLDOWN_MS + 1000;
  r = await tick(store, now, ['lead-a', 'lead-b', 'lead-c'], outcome);
  check('after cooldown, exactly one probe lead is attempted', r.attempted.length === 1, r);
  check('breaker stays tripped after a failed probe', store._raw.purchaseBreaker.tripped === true);

  // A success resets it immediately (mirrors the real Aug-22 timeline: fail
  // 3739x then succeed 4s later).
  now.value += BREAKER_COOLDOWN_MS + 1000;
  r = await tick(store, now, ['lead-that-works'], () => 'ok');
  check('a success resets the breaker', store._raw.purchaseBreaker.tripped === false, store._raw.purchaseBreaker);

  // Immediately after reset, full batches are allowed again (no cooldown).
  r = await tick(store, now, ['lead-x', 'lead-y', 'lead-z'], () => 'ok');
  check('post-reset tick allows the full batch, not just a probe', r.attempted.length === 3, r);
}

// --- Test 2: per-lead attempt cap stops retrying one stubborn lead ---
{
  const now = { value: Date.parse('2026-09-05T06:00:00Z') };
  const store = makeStore(now);
  let attempts = 0;
  for (let i = 0; i < 6; i++) {
    const r = await tick(store, now, ['stubborn-lead'], () => 'fail');
    if (r.attempted.includes('stubborn-lead')) attempts++;
    now.value += 3200;
    // reset breaker manually between iterations to isolate the per-lead cap
    // from the account breaker (breaker behaviour is covered above).
    store._raw.purchaseBreaker = { tripped: false, failedIds: [], trippedAt: null, lastAttemptAt: now.value };
  }
  check(
    `a single lead is attempted at most ${MAX_ATTEMPTS_PER_LEAD} times, not on every tick forever`,
    attempts === MAX_ATTEMPTS_PER_LEAD,
    `attempts=${attempts}`
  );
}

// --- Test 3: replay the Aug-22 shape — bulk failures collapse to a handful of calls ---
{
  const now = { value: Date.parse('2026-08-22T15:36:18Z') };
  const store = makeStore(now);
  const endMs = Date.parse('2026-08-22T20:26:26Z');
  let totalCalls = 0;
  let ticks = 0;
  while (now.value < endMs) {
    const r = await tick(store, now, ['150747324559'], () => 'fail');
    totalCalls += r.attempted.length;
    now.value += 3200;
    ticks++;
  }
  // The real DB shows ~4021 writes across this exact window at this cadence.
  check(
    `Aug-22 replay: ~${ticks} ticks collapse to well under 100 contactBuyNow calls (was 4021 writes)`,
    totalCalls < 100,
    `totalCalls=${totalCalls} ticks=${ticks}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log('\nAll cases passed.');
