# ADR-0003: Keep the cross-repo contract documented, not shared as code

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

The extension and the [mobile app](https://github.com/Nadhim002/lead-notifier-mobile) must agree on
three formats: notification **channel IDs**, the **Firebase project** they both talk to, and the
**Expo push payload** shape. They are separate Git repositories.

## Decision

Express the contract as documentation and matched constants in each repo, **not** as shared code
(no monorepo, no shared npm package). Each repo owns its own copy; the READMEs and
[ARCHITECTURE.md](../ARCHITECTURE.md#cross-repo-wire-contract) state that the copies must be changed
together.

## Consequences

- Both repos stay independent, with no cross-repo build/versioning coupling.
- The risk is silent drift: a channel-ID mismatch makes Android drop notifications; a payload
  mismatch makes the phone unable to render an alert. The mitigation is explicit documentation of
  the contract in both repos and a note at each source (`src/shared/channels.ts`, `pushPayload.ts`).
- Revisit and supersede this ADR if the formats start changing often — that pressure would justify a
  shared package.
