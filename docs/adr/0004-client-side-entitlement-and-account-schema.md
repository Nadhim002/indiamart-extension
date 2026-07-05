# ADR-0004: Client-side entitlement + account-centric schema

## Status

Accepted

## Context

The product is being monetized: usage must be gated behind an admin-managed
subscription, with per-account device limits to stop account-sharing. The system
has **no server** — the extension and phone talk to Firebase directly, and the
extension scrapes/buys IndiaMART leads from the browser using the *seller's own
logged-in session*. Before this change, data was split: subscriptions would
naturally be keyed by email (the admin onboards people before they ever log in
and have a Firebase `uid`), while operational data (`leads`, `devices`) was keyed
by `uid`. Two dead nodes (`pairings`, `leads/{uid}/paired`) also lingered.

## Decision

1. **Enforcement is client-side.** The app reads a subscription record from
   Firebase and refuses to run when it is missing or expired. There is no
   server-side proxy — the scraping fundamentally requires the seller's own
   browser session, so a proxy is impractical. Firebase **security rules** make
   `subscription` read-only to the user and writable only by the admin email,
   which stops casual/normal abuse (the realistic threat for non-technical
   sellers). A determined developer could bypass the client gate; that is an
   accepted trade-off for this audience.

2. **Account-centric schema keyed by sanitized email.** Everything for one seller
   lives under `accounts/{sanitizedEmail}` (profile, subscription, computers,
   phones, leads). This lets the admin pre-provision by email, collapses the
   email/uid split, and makes the admin dashboard a single-subtree read. Dead
   nodes were dropped.

3. **Admin dashboard is a standalone client-side app** authenticated as
   `regentbagsown@gmail.com`, gated by the same security rules — **no Admin SDK,
   no service-account key** (the previously committed key was removed and must be
   rotated). The admin email grants dashboard access only, not product access.

4. **Device seats via minted ids.** Computers get an `installId` (UUID in
   `chrome.storage.local`); phones keep their stable `deviceId`. Limits are
   enforced in the client with **pure self-service** at the cap (remove a device,
   guided by `lastSeen`) — no silent auto-reclaim. Admin can also remove seats.

5. **6-hour cache, tier = label.** The entitlement verdict is cached in
   `chrome.storage.local` for 6h; the panel refreshes it live via `onValue`.
   `tier` (free/paid) is informational only — validity is uniformly "record
   exists and not expired".

## Consequences

- Changes span **both repos** (extension + phone) and the DB rules; they must
  ship together. `sanitizeEmail` and the subscription model are duplicated in the
  phone app and must stay in sync (documented in the cross-repo contract).
- No data migration: the old `uid`-keyed nodes were wiped; devices re-register
  and the admin re-onboards accounts.
- Bypass resistance is limited by design; if that ever matters, a server-side
  proxy or signed entitlement tokens would be the next step.
