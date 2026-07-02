# IndiaMART Lead Notifier — Chrome Extension

A Chrome (Manifest V3) extension that monitors a seller's **IndiaMART Buy-Leads**, automatically
purchases the leads that match your filters, and pushes an alert to your phone (via the companion
[Lead Notifier mobile app](#related-repos--wire-contract)) the moment a lead comes in.

It runs as a **side panel** on `seller.indiamart.com`. You sign in with Google, set your lead
filters, and start a timer. On each tick the extension fetches the latest buy-leads, filters them,
buys the matching ones, records everything to a local database (exportable as CSV), and notifies
every phone signed in to the same Google account.

> ⚠️ **This extension performs real purchases.** See [Safety](#-safety--lead-buying) before running it.

---

## How it works (30-second version)

```
side panel (React)  ──START_TIMER──▶  service worker  ──chrome.alarms──▶  every N seconds:
                                            │
                                            ├─ inject helper + fetch script into the IndiaMART tab
                                            ├─ fetch buy-leads  →  filter (Lead policy)
                                            ├─ buy matching leads (real POST)         [if enabled]
                                            ├─ record all leads to IndexedDB
                                            └─ write lead to Firebase + push to phones (Expo)
```

For the full picture — the module seam, the four storage layers, and the message contract — read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For domain terms (Lead, policy, channel, timer,
device, payload) see [CONTEXT.md](CONTEXT.md).

---

## Repo layout

```
public/manifest.json           MV3 manifest (hand-written, copied to dist/)
panel.html                     side-panel entry HTML
src/
  panel/                       the React side panel (bundled by Vite)
    pages/       App-level pages (DashboardPage = the main screen)
    components/  UI (Radix + Tailwind/shadcn primitives under ui/)
    hooks/       useSettings · useTimer · useDevices
    lib/         firebase, leadsCsv, testNotification
  background/service-worker.js the MV3 service worker (built by Vite → dist/service-worker.js)
  inject/utils-inject.js       page-injected helper (built by Vite → dist/utils-inject.js, IIFE)
  shared/                      single source of truth shared by panel + worker + inject:
                               channels · firebaseConfig · parsers · leadPolicy · pushPayload · types
Resources/                     dev reference material (specs, API captures) — not shipped
docs/                          ARCHITECTURE.md + adr/ (architecture decision records)
```

---

## Prerequisites

- **Node.js 18+** and npm
- **Google Chrome** (or any Chromium browser with MV3 support)
- A **Firebase** project with Realtime Database + Google auth enabled (config already committed in
  `src/shared/firebaseConfig.ts`)
- An active, logged-in **IndiaMART seller** session in the browser (the extension acts on your behalf)

---

## Setup & build

```bash
npm install
npm run build      # tsc --noEmit, then three Vite passes (panel, service worker, inject)
```

The build produces a loadable extension in **`dist/`**:

```
dist/manifest.json
dist/panel.html + assets/
dist/service-worker.js      (single self-contained ES module)
dist/utils-inject.js        (self-executing IIFE, injected into the page)
```

Then load it in Chrome:

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select the **`dist/`** folder.
3. Open `seller.indiamart.com`, then open the extension's **side panel** (or click the toolbar icon).

> **Why three build passes?** The panel is a normal Vite app build. The service worker and the
> page-injected helper are built separately (`vite.worker.config.mjs`, `vite.inject.config.mjs`) as
> single self-contained files so they can `import` from `src/shared` while still loading correctly
> as an MV3 module worker / a classic injected script. See
> [ADR-0002](docs/adr/0002-build-worker-and-inject-via-vite.md).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server for the **panel only** (HMR while iterating on UI) |
| `npm run build` | Full extension build → `dist/` (panel + worker + inject) |
| `npm run typecheck` | `tsc --noEmit` |

> `npm run dev` does **not** build the worker/inject. To exercise the whole extension you must
> `npm run build` and reload the unpacked `dist/`.

---

## Configuration

| What | Where |
|---|---|
| Firebase web config (API key, RTDB URL, project) | `src/shared/firebaseConfig.ts` |
| Google OAuth client id (for `chrome.identity` sign-in) | `src/panel/App.tsx` (`GOOGLE_OAUTH_CLIENT_ID`) |
| Notification channel IDs (must match the mobile app) | `src/shared/channels.ts` |
| Lead-buying master switch | `src/background/service-worker.js` (`ENABLE_LEAD_BUYING`) |

---

## Using it

1. Open the side panel on IndiaMART and **sign in with Google** (use the same account on your phone).
2. Set your **filters** — min price, min quantity, max age, states, include/exclude title keywords.
3. Enter the **interval** (seconds) and, optionally, your **phone number** (sent with purchases).
4. Toggle **Test mode** for a dry run (fetch + filter, **no** purchases).
5. Press **Start**. The status footer shows the cycle count and next-fire countdown.
6. **Export CSV** from the header to download every recorded lead and why it passed/was rejected.

---

## ⚠️ Safety — lead buying

`ENABLE_LEAD_BUYING = true` in `src/background/service-worker.js`. When on **and Test mode is off**,
each tick fires **real `contactBuyNow` POSTs** to `seller.indiamart.com` for every lead that passes
your filters — i.e. it spends real lead credits on your account. To dry-run, keep **Test mode on**
(this disables buying while still fetching, filtering, and recording). Use conservative filters and
a long interval while testing.

---

## Related repos & wire contract

This extension is one half of a two-app system. The other half is the phone client:

- **Mobile app:** [`lead-notifier-mobile`](https://github.com/Nadhim002/lead-notifier-mobile) — the
  Expo/React Native app that receives the alerts.

The two apps are **separate repos** that share three formats by convention (not shared code). If you
change any of these here, change them in the mobile app too:

| Shared format | Extension source | Mobile source |
|---|---|---|
| **Notification channel IDs** | `src/shared/channels.ts` | `channels.ts` |
| **Firebase project** (same RTDB) | `src/shared/firebaseConfig.ts` | `firebase.ts` |
| **Expo push payload shape** | `src/shared/pushPayload.ts` (`buildExpoMessage`) | consumed by `notifications.ts` |

A channel-ID mismatch means Android silently drops the notification; a payload mismatch means the
phone can't render the alert. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#cross-repo-wire-contract).

---

## Security notes

- The committed `src/shared/firebaseConfig.ts` holds the Firebase **web** config (API key). Firebase
  web keys are client identifiers, not server secrets, but access still depends entirely on your
  **Realtime Database security rules** (not in this repo) — keep them locked to authenticated users.
- `Resources/` contains large development captures (`seller.indiamart.com.har`,
  `lead_loading_api_response.json`). A HAR can contain cookies/tokens/PII from the capture session —
  audit before sharing this repo publicly.
