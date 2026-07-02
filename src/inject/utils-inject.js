// Injected into the page's MAIN world by the service worker as a classic
// script (no ESM at runtime), so it attaches a small namespace to `window`.
// The parsers and the Lead acceptance policy are imported from @shared and
// inlined into this file at build time (see vite.inject.config.mjs) — there is
// no runtime import here. This is the single source of `filterLeads`.

import { parsePrice, parseTimeToMinutes, parseQuantity } from '@shared/parsers';
import { filterLeads } from '@shared/leadPolicy';

if (!window.__im_utils) {
  window.__im_utils = { parsePrice, parseTimeToMinutes, parseQuantity, filterLeads };
}
