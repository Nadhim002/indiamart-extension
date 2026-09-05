// One-off table test for the purchaseData -> {purchaseDetails, failedDetails}
// split in injectedFetchAndBuy (src/background/service-worker.js). No test
// runner is configured in this repo, so this mirrors the existing
// scripts/backfill-lead-ids.js convention: a plain node script, run manually.
//
// This re-implements just the split logic (not the whole injected function,
// which needs page globals) so it can run standalone. Keep in sync with
// src/background/service-worker.js if that logic changes shape.
//
// Run: node scripts/test-purchase-outcome-split.mjs

function splitPurchaseOutcomes(purchaseData) {
  const purchaseDetails = [];
  const failedDetails = [];

  for (const { lead, data } of purchaseData) {
    if (data == null) continue; // network/parse failure — dropped silently, same as before

    const ok = data?.Status === 'Success' && data?.Flag === '1';

    if (!ok) {
      failedDetails.push({
        ETO_OFR_ID: lead.ETO_OFR_ID,
        status: data?.Status ?? null,
        flag: data?.Flag ?? null,
        message: data?.Message ?? null,
      });
      continue;
    }

    const detail = Array.isArray(data?.Data) ? data.Data[0] : null;
    purchaseDetails.push({
      ETO_OFR_ID: lead.ETO_OFR_ID,
      buyerMobile: detail?.GLUSR_USR_PH_MOBILE ?? detail?.GLUSR_USR_PH_MOBILE_ALT ?? null,
      buyerName: detail?.GLUSR_NAME ?? null,
    });
  }

  return { purchaseDetails, failedDetails };
}

const lead = (id) => ({ ETO_OFR_ID: id, ETO_OFR_TITLE: 'Test lead' });

const cases = [
  {
    name: 'Success with buyer data',
    purchaseData: [{ lead: lead('1'), data: { Status: 'Success', Flag: '1', Data: [{ GLUSR_NAME: 'Buyer', GLUSR_USR_PH_MOBILE: '9999999999' }] } }],
    expect: { purchased: 1, failed: 0, buyerPresent: true },
  },
  {
    name: 'Success with empty Data array (tolerated — still a real purchase)',
    purchaseData: [{ lead: lead('2'), data: { Status: 'Success', Flag: '1', Data: [] } }],
    expect: { purchased: 1, failed: 0, buyerPresent: false },
  },
  {
    name: 'Failure response — the bug this guards against',
    purchaseData: [{ lead: lead('3'), data: { Status: 'Failure', Flag: '0', Message: 'Insufficient balance' } }],
    expect: { purchased: 0, failed: 1, buyerPresent: false },
  },
  {
    name: 'Flag "0" with Status Success (should not count as ok)',
    purchaseData: [{ lead: lead('4'), data: { Status: 'Success', Flag: '0' } }],
    expect: { purchased: 0, failed: 1, buyerPresent: false },
  },
  {
    name: 'data: null (network failure) — dropped entirely, neither bucket',
    purchaseData: [{ lead: lead('5'), data: null }],
    expect: { purchased: 0, failed: 0, buyerPresent: false },
  },
  {
    name: 'Mixed batch',
    purchaseData: [
      { lead: lead('6'), data: { Status: 'Success', Flag: '1', Data: [{ GLUSR_NAME: 'B' }] } },
      { lead: lead('7'), data: { Status: 'Failure', Flag: '0' } },
      { lead: lead('8'), data: null },
    ],
    expect: { purchased: 1, failed: 1, buyerPresent: true },
  },
];

let failures = 0;
for (const c of cases) {
  const { purchaseDetails, failedDetails } = splitPurchaseOutcomes(c.purchaseData);
  const buyerPresent = purchaseDetails.some((d) => d.buyerName || d.buyerMobile);
  const ok =
    purchaseDetails.length === c.expect.purchased &&
    failedDetails.length === c.expect.failed &&
    buyerPresent === c.expect.buyerPresent;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) {
    failures++;
    console.log('  purchaseDetails:', JSON.stringify(purchaseDetails));
    console.log('  failedDetails  :', JSON.stringify(failedDetails));
  }
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log('\nAll cases passed.');
