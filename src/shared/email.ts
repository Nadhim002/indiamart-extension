// Firebase RTDB keys cannot contain '.', '#', '$', '[', or ']'. The
// account-centric schema keys every account by the user's email, so email
// strings must be sanitized into legal keys consistently everywhere they are
// used as a path segment (extension panel, service worker, phone app, admin
// dashboard). This is the single source of truth for that transform.
//
// The mapping is lossy-but-deterministic: each illegal char maps to a distinct
// placeholder so different emails cannot collide. We never need to reverse it —
// the raw email is always stored in profile.email.

const ILLEGAL_TO_SAFE: Record<string, string> = {
  '.': ',',   // most common (every email has one) → ',' matches Firebase docs' convention
  '#': '%23',
  '$': '%24',
  '[': '%5B',
  ']': '%5D',
};

export function sanitizeEmail(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[.#$[\]]/g, (ch) => ILLEGAL_TO_SAFE[ch] ?? ch);
}
