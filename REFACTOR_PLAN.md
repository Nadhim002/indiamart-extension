# Refactor Plan — indiamart-extension

> Paste this into a GitHub issue on `Nadhim002/indiamart-extension`. Scope agreed: **structure + dedup only.** No new tests, no type-safety hardening pass, no secret/artifact cleanup in this refactor (see Out of Scope).

## Problem Statement

The extension is split into two worlds that don't share code. Everything under `src/` is strict TypeScript built by Vite; everything under `public/` — including the 523-line service worker, which is the most complex code in the project — is untyped vanilla JS that Vite copies verbatim and never type-checks. Because the two worlds can't import from each other, the same formats are hand-copied and kept in sync by comment convention:

- Channel IDs live in both `public/channels.js` and `src/panel/lib/channels.ts`.
- Firebase config lives in both `public/firebase-config.js` and `src/panel/firebaseConfig.ts`.
- The lead-filter rules are re-implemented three times: the injected `filterLeads` (page context), the service worker's `computeRejectionReasons` (the inverse, for CSV reasons), and the shape in the panel's types.
- The Expo push payload is built identically in the service worker (production) and in `DashboardPage` (the test button).

On top of that, `DashboardPage.tsx` is a ~350-line god component holding 11 pieces of state plus settings persistence, timer polling, a Firebase device subscription, CSV export, and push-test plumbing all inline. The result: any format change means editing several files across the two worlds by hand, drift is already visible, and the busiest component is hard to reason about.

## Solution

Bring the service worker into the Vite build so it can import the same typed modules the panel uses, then establish **one source of truth per shared format inside this repo** (channels, Firebase config, filter rules, push payload) that both the panel and the service worker consume. Separately, decompose `DashboardPage` into focused hooks and pure helpers so the page only composes them. The cross-repo contract with `mobile-app` stays a documented convention (not shared code) by explicit decision.

## Commits

Each commit leaves the extension loadable and `tsc --noEmit && vite build` green. After every commit, load the unpacked extension and confirm the timer start/stop and lead list still work.

1. **Introduce `src/shared/` and relocate the panel's existing shared modules.** Move `channels.ts` and `firebaseConfig.ts` out of `src/panel/lib` / `src/panel` into a `src/shared/` area, leaving thin re-exports at the old import paths so nothing else changes yet. Build unchanged.

2. **Bring the service worker into the Vite build.** Relocate the service worker source out of `public/` into a `src/` entry, add it as a second Rollup input, and configure output so it still emits to the exact `service-worker.js` path the manifest references. Do **not** change its logic. Verify the built worker byte-behaves the same and the extension still loads and runs a timer cycle.

3. **Make the service worker consume the shared channels + Firebase config, then delete the `public/` copies.** Point the (now bundled) worker at `src/shared` channels and config, delete `public/channels.js` and `public/firebase-config.js`. One source of truth for channels and config within the repo.

4. **Extract the lead-filter rule set into one shared module.** Define the include/exclude/price/quantity/time rules once in `src/shared`. Rewrite the injected `filterLeads` and the worker's `computeRejectionReasons` to derive from that single definition. If the injected helper must be built to import shared code, add it as a build input in this commit. Verify filtering and CSV rejection reasons match previous behavior on a sample lead set.

5. **Extract the Expo push payload builder into one shared module.** Have both the worker's production notification path and `DashboardPage`'s test button call the single builder. Verify a test notification fires with an identical payload shape.

6. **Extract settings persistence into a `useSettings` hook.** Move the `localStorage` `im-extension-settings` load/save out of `DashboardPage` into a hook. Verify settings persist across reloads.

7. **Extract timer state into a `useTimer` hook.** Move the `GET_TIMER_STATE` polling and `START_TIMER`/`STOP_TIMER` messaging out of `DashboardPage`. Verify the timer UI and controls.

8. **Extract the Firebase device subscription into a `useDevices` hook.** Move the `onValue` devices subscription out of `DashboardPage`. Verify the devices list renders.

9. **Extract CSV export into a pure `leadsToCsv` module + thin handler.** Move the escaping/serialization logic out of the component. Verify an exported CSV matches the previous output.

10. **Reduce `DashboardPage` to composition.** With the hooks and helpers extracted, the component should mostly wire them together. Verify the full dashboard end to end.

11. **Type the two untyped background messages.** Fold `GET_TIMER_STATE` and `GET_ALL_LEADS` into the existing `BackgroundCommandType` union so all four message types are typed the same way. (Consistency of the messaging contract, not a broader type pass.)

12. **Doc reconciliation.** Update `Resources/Specs.md` to describe the actual Vite setup (it currently claims `@crxjs/vite-plugin`, which is not installed) and remove the now-dead `CHANNEL_CALL` export if it is still unused after dedup.

## Decision Document

- **Two-world split is resolved by building, not by copying.** The service worker becomes a Vite/Rollup build entry so it can import typed modules; `public/` stops being a parallel source of code.
- **One source of truth per shared format, scoped to this repo.** Channels, Firebase config, filter rules, and the push payload each get a single module under a shared area, consumed by both the panel and the worker.
- **The cross-repo contract with `mobile-app` stays documented, not shared code.** By decision, no monorepo or shared package; the format is described in a comment/contract and duplicated across repos intentionally.
- **`DashboardPage` becomes a composition of hooks + pure helpers.** Settings, timer, and device concerns move into dedicated hooks; CSV and payload logic move into pure modules.
- **Messaging contract is uniformly typed** via the existing command-type union.
- **The manifest stays a hand-written static file**; only the build output paths it points to are affected, and they are kept stable.

## Testing Decisions

- No test harness exists today and none is added in this refactor (out of scope by decision). Verification for every commit is: `tsc --noEmit && vite build` succeeds, the unpacked extension loads, and a manual smoke test of timer start/stop, lead listing, and a test notification passes.
- A good test here would exercise **external behavior only** — e.g. "given this raw lead payload and these filter settings, these leads pass and these are rejected with these reasons" — never the internals of a hook.
- The extractions in commits 4, 5, and 9 (filter rules, push payload, CSV serialization) are deliberately pulled into **pure modules** so that a future test pass can cover them without a browser. There is no prior art for tests in this repo; the first tests added later should target those pure modules.

## Out of Scope

- Adding a test runner or any tests.
- A general type-safety hardening pass (removing casts, tightening loose response shapes beyond the messaging union in commit 11).
- Bringing the large injected inline `func` in the service worker under full typing/decomposition beyond what dedup requires.
- Introducing a storage abstraction over the four persistence mechanisms (localStorage, chrome.storage, IndexedDB, Firebase RTDB).
- Removing committed secrets/artifacts (`firebase-config` API key, the 1.35 MB `seller.indiamart.com.har`, large data JSON, committed review diffs).
- Extracting a shared package/monorepo across the two repos.

## Further Notes

- **Latent bug spotted during mapping (not fixed here):** in the service worker, `purchaseDetails` is declared inside the `if (enableLeadBuying)` block but referenced in the outer return via `typeof purchaseDetails !== 'undefined' ? … : []`, where the block-scoped const is not visible — so it is always `undefined` and returns `[]`. Worth a separate one-line fix commit; flagged here so it isn't lost.
- **`ENABLE_LEAD_BUYING = true`** makes the injected code fire real `contactBuyNow` POSTs. Be careful running manual smoke tests against a live seller account during this refactor.
- The header of `sec-ch-ua` in the two worker fetches disagrees (Chrome vs Brave) — copy-paste from different HAR captures; harmless but worth normalizing when the worker is touched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
