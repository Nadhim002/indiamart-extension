// One-time console migration: backfill ETO_OFR_ID onto the purchased leads
// already sitting in Firebase RTDB under accounts/{email}/leads/new.
//
// Why this has to run on the user's own computer: the payload written at
// sendLeadNotifications() never included the lead id, so every historical
// Firebase record is anonymous as far as IndiaMART's identifier goes. The ids
// exist in exactly one place — that machine's IndexedDB (indiamart_leads,
// keyPath ETO_OFR_ID). There is no server-side source of truth to migrate
// from, so the join has to happen locally, per computer.
//
// HOW TO RUN
//   1. chrome://extensions → the extension → "Inspect views: service worker"
//   2. Paste this whole file into that console, press Enter.
//   3. await backfillLeadIds()               ← dry run, writes nothing
//   4. await backfillLeadIds({ apply: true })  ← the real run
//
// It MUST be the service worker console: this leans on rtdbFetch() already
// being in scope, which carries the account, the id token, and the re-mint-on-
// 401 retry. Re-running is safe — records that already carry an ETO_OFR_ID are
// skipped, so a partial run can simply be run again.

(function () {
  const DB_NAME = 'indiamart_leads';
  const STORE_NAME = 'leads';
  const RTDB_NODE = 'leads/new';

  // Firebase `timestamp` is when the lead was purchased; IndexedDB
  // `firstSeenAtMs` is when it was first seen in a poll cycle. Same cycle
  // usually, so they land seconds apart — but a lead first seen, skipped, then
  // bought on a later cycle can drift. 48h is loose enough to survive that and
  // tight enough that it can't pull in a genuinely different lead.
  const DEFAULT_WINDOW_MS = 48 * 60 * 60 * 1000;

  // Trim, collapse runs of whitespace, case-fold. The same lead title can come
  // back from IndiaMART with different spacing between the list response and
  // whatever got stored, and that must not break the join.
  const norm = (v) =>
    v == null ? '' : String(v).trim().toLowerCase().replace(/\s+/g, ' ');

  // Price and quantity cross the wire in mixed shapes — RTDB stores quantity as
  // String(quantity) and price straight off ETO_OFR_APPROX_ORDER_VALUE, which
  // has already been through parsePrice on one side and not the other. Compare
  // them as numbers so "1200" and 1200 are the same lead.
  const numKey = (v) => {
    if (v == null || v === '') return '';
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? String(n) : norm(v);
  };

  const remoteKey = (rec) =>
    [norm(rec.title), numKey(rec.price), numKey(rec.quantity), norm(rec.city), norm(rec.state)].join('|');

  const localKey = (lead) =>
    [
      norm(lead.ETO_OFR_TITLE),
      numKey(lead.ETO_OFR_APPROX_ORDER_VALUE),
      numKey(lead.quantity),
      norm(lead.GLUSR_CITY),
      norm(lead.GLUSR_STATE),
    ].join('|');

  // Opened without a version on purpose: passing one would trigger
  // onupgradeneeded against a store this script has no business migrating.
  function readLocalLeads() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onerror = (e) => reject(e.target.error);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          resolve([]);
          return;
        }
        const getAll = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        getAll.onsuccess = (ev) => {
          db.close();
          resolve(ev.target.result || []);
        };
        getAll.onerror = (ev) => {
          db.close();
          reject(ev.target.error);
        };
      };
    });
  }

  function indexBy(leads, keyFn) {
    const map = new Map();
    for (const lead of leads) {
      const k = keyFn(lead);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(lead);
    }
    return map;
  }

  // Several local leads share this key. Prefer the one whose first-seen time is
  // nearest the purchase timestamp, but only inside the window, and only if
  // there is a single nearest — two candidates equidistant from the timestamp
  // is a coin flip, and a coin flip writes the wrong id half the time.
  function resolveByTime(candidates, timestamp, windowMs) {
    if (typeof timestamp !== 'number') return { winner: null, why: 'no timestamp on the DB record' };

    const scored = candidates
      .map((lead) => ({ lead, delta: Math.abs((lead.firstSeenAtMs ?? NaN) - timestamp) }))
      .filter((c) => Number.isFinite(c.delta) && c.delta <= windowMs)
      .sort((a, b) => a.delta - b.delta);

    if (scored.length === 0) return { winner: null, why: `no candidate within ${Math.round(windowMs / 3600000)}h` };
    if (scored.length > 1 && scored[0].delta === scored[1].delta) {
      return { winner: null, why: 'two candidates equidistant in time' };
    }
    return { winner: scored[0].lead, delta: scored[0].delta };
  }

  async function patchInChunks(entries, size, onProgress) {
    const written = [];
    const failed = [];
    for (let i = 0; i < entries.length; i += size) {
      const chunk = entries.slice(i, i + size);
      const results = await Promise.allSettled(
        chunk.map(({ pushKey, ETO_OFR_ID }) =>
          rtdbFetch(`${RTDB_NODE}/${pushKey}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ETO_OFR_ID, idBackfilledAt: Date.now() }),
          }).then((res) => {
            if (!res) throw new Error('not signed in');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return true;
          })
        )
      );
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') written.push(chunk[j]);
        else failed.push({ ...chunk[j], error: r.reason?.message ?? String(r.reason) });
      });
      onProgress(Math.min(i + size, entries.length), entries.length);
    }
    return { written, failed };
  }

  /**
   * @param {object}  [opts]
   * @param {boolean} [opts.apply=false]  false = dry run (default). true = write to Firebase.
   * @param {number}  [opts.windowMs]     tiebreak window for duplicate matches. Default 48h.
   */
  globalThis.backfillLeadIds = async function backfillLeadIds(opts = {}) {
    const { apply = false, windowMs = DEFAULT_WINDOW_MS } = opts;

    if (typeof rtdbFetch !== 'function') {
      throw new Error(
        'rtdbFetch() is not in scope — run this in the extension service worker console ' +
          '(chrome://extensions → Inspect views: service worker), not the panel or a page console.'
      );
    }

    console.log(`[Backfill] ${apply ? 'REAL RUN — this writes to Firebase' : 'DRY RUN — nothing will be written'}`);

    const res = await rtdbFetch(RTDB_NODE);
    if (!res) throw new Error('Not signed in — open the panel, sign in, then retry.');
    if (!res.ok) throw new Error(`Firebase read failed: HTTP ${res.status}`);
    const remote = (await res.json()) || {};
    const remoteEntries = Object.entries(remote);

    const allLocal = await readLocalLeads();
    const purchased = allLocal.filter((l) => l.reasons === 'Purchased');
    console.log(
      `[Backfill] ${remoteEntries.length} leads in DB · ${purchased.length} purchased leads in IndexedDB (of ${allLocal.length} total local)`
    );

    const purchasedIndex = indexBy(purchased, localKey);
    // Only ever used to explain a miss — never to match. If a DB lead has no
    // purchased local row but does have a non-purchased one, that's a local
    // record whose `reasons` never got upgraded, which is worth knowing about
    // but is not grounds for writing an id.
    const allLocalIndex = indexBy(allLocal, localKey);

    const plan = [];
    const ambiguous = [];
    const unmatched = [];
    const alreadyHasId = [];

    for (const [pushKey, rec] of remoteEntries) {
      if (!rec || typeof rec !== 'object') {
        unmatched.push({ pushKey, title: '(malformed record)', reason: 'not an object' });
        continue;
      }
      if (rec.ETO_OFR_ID != null && rec.ETO_OFR_ID !== '') {
        alreadyHasId.push({ pushKey, ETO_OFR_ID: rec.ETO_OFR_ID });
        continue;
      }

      const key = remoteKey(rec);
      const candidates = purchasedIndex.get(key) || [];
      const row = { pushKey, title: rec.title ?? '', city: rec.city ?? '', state: rec.state ?? '' };

      if (candidates.length === 1) {
        plan.push({ ...row, ETO_OFR_ID: candidates[0].ETO_OFR_ID, via: 'unique' });
      } else if (candidates.length > 1) {
        const { winner, why, delta } = resolveByTime(candidates, rec.timestamp, windowMs);
        if (winner) {
          plan.push({
            ...row,
            ETO_OFR_ID: winner.ETO_OFR_ID,
            via: `time (${candidates.length} candidates, ±${Math.round(delta / 60000)}m)`,
          });
        } else {
          ambiguous.push({ ...row, candidates: candidates.length, reason: why });
        }
      } else {
        const relaxed = allLocalIndex.get(key) || [];
        unmatched.push({
          ...row,
          reason: relaxed.length
            ? `${relaxed.length} local row(s) match but aren't marked Purchased`
            : 'no local lead with these fields',
        });
      }
    }

    // Buyer name and mobile are deliberately kept out of everything printed
    // here — verifying a match only needs the lead fields, and console output
    // gets screenshotted and pasted around.
    console.log(
      `[Backfill] will change: ${plan.length} · ambiguous (skipped): ${ambiguous.length} · ` +
        `unmatched (skipped): ${unmatched.length} · already had an id: ${alreadyHasId.length}`
    );
    if (plan.length) {
      console.log('[Backfill] rows that will change:');
      console.table(plan.slice(0, 200));
      if (plan.length > 200) console.log(`  …and ${plan.length - 200} more (see result.plan)`);
    }
    if (ambiguous.length) {
      console.log('[Backfill] ambiguous — left untouched:');
      console.table(ambiguous.slice(0, 50));
    }
    if (unmatched.length) {
      console.log('[Backfill] unmatched — left untouched:');
      console.table(unmatched.slice(0, 50));
    }

    const summary = {
      totalInDb: remoteEntries.length,
      willChange: plan.length,
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
      alreadyHasId: alreadyHasId.length,
      plan,
      ambiguousRows: ambiguous,
      unmatchedRows: unmatched,
    };

    if (!apply) {
      console.log('[Backfill] Dry run complete — nothing written. Re-run with { apply: true } to write.');
      return { ...summary, applied: false };
    }

    if (plan.length === 0) {
      console.log('[Backfill] Nothing to write.');
      return { ...summary, applied: true, written: 0, failed: [] };
    }

    const { written, failed } = await patchInChunks(plan, 25, (done, total) =>
      console.log(`[Backfill] wrote ${done}/${total}`)
    );
    console.log(`[Backfill] Done — ${written.length} written, ${failed.length} failed.`);
    if (failed.length) console.table(failed.slice(0, 50));

    return { ...summary, applied: true, written: written.length, failed };
  };

  console.log('[Backfill] Loaded. Run: await backfillLeadIds()   then: await backfillLeadIds({ apply: true })');
})();
