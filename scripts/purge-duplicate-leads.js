#!/usr/bin/env node
// One-time admin cleanup for the RTDB write-storm bug fixed in v1.5.3 (see
// git log for "stop rejected IndiaMART purchases from being written as
// bought leads"): a rejected contactBuyNow response used to be written to
// accounts/{email}/leads/new anyway, and since the same unbuyable lead is
// re-attempted on every timer tick, one account (ashishkumarp1@gmail.com)
// accumulated ~33k duplicate rows for ~123 distinct leads.
//
// Unlike scripts/backfill-lead-ids.js (which must run inside the extension's
// own service-worker console, because it joins against that machine's local
// IndexedDB), this is a pure RTDB cleanup with no local join needed, so it
// runs as a plain Node script against the Firebase CLI — the same tool and
// project-owner auth used to investigate this bug in the first place
// (`firebase login:list` / `firebase database:get`).
//
// DELETE RULE (deliberately conservative):
//   A row is deleted iff ALL of:
//     - it has a non-empty ETO_OFR_ID (protects legacy pre-2026-08-19 rows
//       written before that field existed — they'd otherwise collapse into
//       one false "duplicate" group under the "(missing)" key)
//     - that ETO_OFR_ID occurs more than once in the node (a lead seen only
//       once is left alone even with no buyerMobile — could be a real
//       purchase whose response had an empty Data[] array, which is valid)
//     - the row has no buyerMobile (rejected purchases never carry buyer
///      contact info — RTDB strips null fields on write, so its absence is
//       the same signal used to diagnose this bug)
//   This preserves every row that carries buyer contact info (the genuine
//   purchases) and every non-duplicated row, and only removes rejected-
//   purchase noise.
//
// HOW TO RUN
//   Dry run (default, writes nothing):
//     node scripts/purge-duplicate-leads.js
//   Real run:
//     node scripts/purge-duplicate-leads.js --apply
//   Different account (still requires --i-understand, see below):
//     node scripts/purge-duplicate-leads.js --account "other@example.com" --apply --i-understand
//
// Requires the Firebase CLI to already be logged in as a project owner/editor
// (`firebase login`) — that's what lets this bypass RTDB security rules the
// same way `firebase database:get` did during the investigation.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const PROJECT = 'indiamart-extension-notifier';
const RTDB_NODE = 'leads/new';
const CHUNK_SIZE = 500; // keys per database:update call

// The one account this investigation confirmed is affected. Deliberately
// hardcoded as the default so a bare `node purge-duplicate-leads.js --apply`
// can't accidentally touch anyone else — see the RCA notes: every other
// account showed at most a handful of duplicate rows from an unrelated,
// much smaller cause (a genuinely-succeeded purchase written twice), which
// this script's delete rule does not remove anyway (those rows DO carry
// buyerMobile). Pass --account to target a different one explicitly.
const DEFAULT_ACCOUNT = 'ashishkumarp1@gmail.com';

function sanitizeEmail(email) {
  const ILLEGAL_TO_SAFE = { '.': ',', '#': '%23', '$': '%24', '[': '%5B', ']': '%5D' };
  return email.trim().toLowerCase().replace(/[.#$[\]]/g, (ch) => ILLEGAL_TO_SAFE[ch] ?? ch);
}

function parseArgs(argv) {
  const args = { apply: false, account: DEFAULT_ACCOUNT, iUnderstand: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--i-understand') args.iUnderstand = true;
    else if (a === '--account') args.account = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function firebaseGet(rtdbPath) {
  const tmp = path.join(os.tmpdir(), `purge-duplicate-leads-${Date.now()}.json`);
  try {
    execFileSync(
      'firebase',
      ['database:get', `/${rtdbPath}`, '--project', PROJECT, '-o', tmp],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    );
    const raw = fs.readFileSync(tmp, 'utf8');
    return raw.trim() ? JSON.parse(raw) : null;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function firebaseUpdate(rtdbPath, patch) {
  const tmp = path.join(os.tmpdir(), `purge-duplicate-leads-patch-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(patch));
  try {
    execFileSync(
      'firebase',
      ['database:update', `/${rtdbPath}`, tmp, '--project', PROJECT, '-f'],
      { stdio: ['ignore', 'inherit', 'inherit'] }
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function planDeletes(node) {
  const entries = Object.entries(node || {});
  const byId = new Map();
  for (const [key, row] of entries) {
    const id = row && row.ETO_OFR_ID != null && row.ETO_OFR_ID !== '' ? String(row.ETO_OFR_ID) : null;
    if (id === null) continue; // never a delete candidate — see DELETE RULE
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push([key, row]);
  }

  const toDelete = [];
  const toKeep = [];
  for (const [id, rows] of byId) {
    if (rows.length <= 1) continue; // not a duplicate — leave alone
    for (const [key, row] of rows) {
      if (row.buyerMobile) toKeep.push({ key, id, reason: 'has buyerMobile' });
      else toDelete.push({ key, id });
    }
  }

  const total = entries.length;
  const distinctIds = byId.size;
  return { toDelete, toKeep, total, distinctIds };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 45).join('\n'));
    return;
  }

  if (args.account !== DEFAULT_ACCOUNT && !args.iUnderstand) {
    console.error(
      `Refusing to target "${args.account}" — only ${DEFAULT_ACCOUNT} is confirmed affected by this bug.\n` +
        `Every other account's duplicates come from a different, much smaller cause (a genuinely-\n` +
        `succeeded purchase written twice) and this script's delete rule will not remove those rows\n` +
        `anyway (they carry buyerMobile). If you've independently confirmed this account has the\n` +
        `same signature (many rows sharing one ETO_OFR_ID, none with buyerMobile), re-run with\n` +
        `--i-understand.`
    );
    process.exitCode = 1;
    return;
  }

  const accountKey = sanitizeEmail(args.account);
  const rtdbPath = `accounts/${accountKey}/${RTDB_NODE}`;

  console.log(`[Purge] Reading ${rtdbPath} ...`);
  const node = firebaseGet(rtdbPath);
  if (!node) {
    console.log('[Purge] Node is empty or does not exist — nothing to do.');
    return;
  }

  const { toDelete, toKeep, total, distinctIds } = planDeletes(node);
  console.log(
    `[Purge] account=${args.account}  rows=${total}  distinct ETO_OFR_ID=${distinctIds}\n` +
      `[Purge] will delete: ${toDelete.length}  will keep: ${total - toDelete.length} ` +
      `(of which ${toKeep.length} kept specifically for carrying buyerMobile)`
  );

  if (toDelete.length === 0) {
    console.log('[Purge] Nothing matches the delete rule — nothing to do.');
    return;
  }

  // Sample so a reviewer can sanity-check the plan before --apply.
  console.log('[Purge] sample of rows that will be deleted (first 10):');
  console.table(toDelete.slice(0, 10));

  if (!args.apply) {
    console.log(
      `\n[Purge] DRY RUN — nothing written. Re-run with --apply to delete these ${toDelete.length} rows.`
    );
    return;
  }

  console.log(`[Purge] REAL RUN — deleting ${toDelete.length} rows in chunks of ${CHUNK_SIZE} ...`);
  for (let i = 0; i < toDelete.length; i += CHUNK_SIZE) {
    const chunk = toDelete.slice(i, i + CHUNK_SIZE);
    const patch = Object.fromEntries(chunk.map(({ key }) => [key, null]));
    firebaseUpdate(rtdbPath, patch);
    console.log(`[Purge] deleted ${Math.min(i + CHUNK_SIZE, toDelete.length)}/${toDelete.length}`);
  }
  console.log('[Purge] Done.');
}

main().catch((err) => {
  console.error('[Purge] Failed:', err.message);
  process.exitCode = 1;
});
