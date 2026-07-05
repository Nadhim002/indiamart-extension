# CONTEXT — domain glossary

Shared vocabulary for the IndiaMART Lead Notifier. Use these terms consistently in code, comments,
docs, and reviews. The [mobile app](https://github.com/Nadhim002/lead-notifier-mobile) uses the same
glossary so the two repos speak one language.

| Term | Meaning |
|---|---|
| **Lead** (Buy-Lead) | A buyer enquiry on IndiaMART's seller portal. The unit this whole system reacts to. Identified by `ETO_OFR_ID`. |
| **Lead policy** | The single set of accept/reject rules a lead is judged against. Lives in `src/shared/leadPolicy.ts` as `evaluateLead`; filtering and rejection-reason text both derive from it. |
| **Filters** | The user-configured thresholds the policy applies: min price, min quantity, max age (minutes), states, include/exclude title keywords. Type `LeadFilters`. |
| **Rejection reason** | Human-readable text explaining why a lead did not pass (e.g. "Price too low"), recorded per lead for the CSV export. |
| **Channel** | An Android notification channel. Two exist: **banner** (`lead-alerts-banner`, a heads-up notification) and **call** (`lead-alerts-call`, the phonecall/full-screen style). IDs in `src/shared/channels.ts`. |
| **Timer / cycle** | The repeating poll. The worker schedules a `chrome.alarms` tick every N seconds; each tick is one **cycle**. |
| **Account** | Everything for one seller, keyed by their email at `accounts/{sanitizedEmail}` in Firebase: profile, subscription, computers, phones, and the leads push channel. The unit the admin manages. |
| **Subscription** | The admin-set entitlement record (`tier`, `expiryDate`, `lastPaidDate`, `maxComputers`, `maxPhones`). Source of truth for whether an account may run the product. |
| **Tier** | A label on a subscription: `free` (trial) or `paid`. **Only a label** — enforcement is identical for both (valid = record exists and not expired). |
| **Seat** | One allowed device slot. Computers use `installId`, phones use `deviceId`; counts are capped by `maxComputers` / `maxPhones`. At the limit the user self-removes a device to free a seat. |
| **installId** | A per-browser-installation UUID (`chrome.storage.local`) identifying one computer seat under `accounts/{email}/computers/{installId}`. The extension analogue of the phone's `deviceId`. |
| **sanitizedEmail** | An email transformed by `sanitizeEmail` into a legal RTDB key (illegal chars `. # $ [ ]` replaced). The account key; must match across extension, phone, and dashboard. |
| **Entitlement / lockout** | The client-side check (`evaluateSubscription`) of a subscription. Invalid → **full lockout** (extension `LockoutPage` / phone `LockoutScreen`); the worker also refuses/stops automation. Cached 6h in `chrome.storage.local`. |
| **Admin** | `regentbagsown@gmail.com`. Grants **admin-dashboard management only** (via security rules) — **not** product access. To use the extension/phone, the admin must be onboarded like any user. |
| **Device / registered device** | A phone (`deviceId`) or computer (`installId`) on an account, stored at `accounts/{sanitizedEmail}/phones|computers/{id}` with a user-set name, `lastSeen`, and (phones) Expo push token + notification style. |
| **Notification style** | Per-device preference: `headsup` (banner) or `phonecall` (full-screen incoming-call UI on the phone). |
| **Payload** | The lead data delivered to the phone (title, buyer name/mobile, quantity, city, state, timestamp), wrapped into an Expo push message by `buildExpoMessage`. |
| **Purchase / buy** | Spending a lead credit via the `contactBuyNow` POST. Gated by `ENABLE_LEAD_BUYING` and disabled in **test mode**. |
| **Test mode** | A dry run: fetch + filter + record, but **no** purchases and no real spend. |
| **Inject helper** | `window.__im_utils` — parsers + `filterLeads`, injected into the IndiaMART page's MAIN world so filtering runs with the seller's session. |
