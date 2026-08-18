// The admin/owner contact shown to locked-out or device-limited users. This is
// the same identity that manages the admin dashboard; here it is used purely as
// a "who to contact for access" address.
export const ADMIN_CONTACT_EMAIL = 'regentbagsown@gmail.com';

// The customer's web dashboard — subscription status plus charts built from the
// lead-history sheet this extension syncs. Linked from here rather than left to
// be typed: nobody remembers a URL path, and the side panel is the one surface
// a seller already has open every day.
//
// Opens in a tab via target="_blank"; the panel itself can't host it, since the
// dashboard signs in with a Firebase popup against imleads.in.
export const DASHBOARD_URL = 'https://imleads.in/dashboard';
