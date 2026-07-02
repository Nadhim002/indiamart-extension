# ADR-0001: Deduplicate shared formats within each repo, not across repos

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Channel IDs, Firebase config, the lead filter, and the Expo push payload were duplicated — both
*within* the extension (untyped `public/*.js` copies vs. typed `src/` copies) and *across* the two
repos (extension and mobile app). We wanted to remove the duplication that causes drift.

## Decision

Deduplicate **within** each repo to a single source of truth (`src/shared` here), but keep the
**cross-repo** formats (channels, Firebase project, push payload) as a *documented convention*, not
shared code. No monorepo, no published shared package.

## Consequences

- Each repo has one internal source for each shared value; intra-repo drift is gone.
- The two repos stay independent and simple to build and deploy.
- The cross-repo contract must be maintained by hand — mitigated by documenting it in both READMEs
  and in [ADR-0003](0003-cross-repo-contract-documented.md).
