// Injected into the page's MAIN world by the service worker as a classic
// script (no ESM at runtime), so it attaches a small namespace to `window`.
// The parsers and the Lead acceptance policy are imported from @shared and
// inlined into this file at build time (see vite.inject.config.mjs) — there is
// no runtime import here. This is the single source of `filterLeads`.

import { parsePrice, parseTimeToMinutes, parseQuantity } from '@shared/parsers';
import { filterLeads, rejectionReason } from '@shared/leadPolicy';

// Assigned unconditionally, not behind an `if (!window.__im_utils)` guard.
// The worker re-injects this file before every cycle, but with a guard the
// FIRST injection into a page won on that page forever — so reloading the
// extension after adding a helper left every already-open IndiaMART tab
// holding the old namespace, and the new helper was missing until the user
// happened to reload the page. Overwriting is safe: these are pure functions
// and each injection carries an identical, self-contained copy.
//
// rejectionReason is exposed so the cycle's lead table can show *why* each
// skipped lead was skipped, using the same policy that did the filtering
// rather than a second, drifting explanation.
window.__im_utils = {
  parsePrice,
  parseTimeToMinutes,
  parseQuantity,
  filterLeads,
  rejectionReason,
};
