// Android notification channel IDs — used by the service worker (raw ES module,
// copied verbatim from public/ to dist/ by Vite).
//
// WIRE CONTRACT: these IDs must stay in sync with:
//   - indiamart-extension/src/panel/lib/channels.ts (the bundled panel's copy)
//   - mobile-app/channels.ts (the device that creates these channels)
// A mismatch means the push targets a channel that does not exist on the device,
// and Android silently drops the notification. Update all three together.

export const CHANNEL_BANNER = 'lead-alerts-banner';
export const CHANNEL_CALL = 'lead-alerts-call';
