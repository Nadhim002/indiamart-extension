// Android notification channel IDs — the single source of truth for this repo.
// Consumed by the bundled panel (TS import) AND the bundled service worker
// (import inlined at build time). There is no longer a hand-copied public/ twin.
//
// CROSS-REPO WIRE CONTRACT: these IDs must still match mobile-app/channels.ts
// (the device that creates the channels). A mismatch means the push targets a
// channel that does not exist on the device and Android silently drops it.

export const CHANNEL_BANNER = 'lead-alerts-banner';
export const CHANNEL_CALL = 'lead-alerts-call';
