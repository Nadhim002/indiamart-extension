## Plan: IndiaMart Chrome Extension Implementation

TL;DR: Build a Chrome MV3 extension from scratch that polls `https://seller.indiamart.com/blreact/getBLDisplayData` on a user-configured timer, recovers `glusrid` from the page/session if missing, and exposes a start/stop UI with status and logs.

**Steps**
1. Confirm the current repo has no existing source files or package config, then scaffold the extension structure.
2. Create Chrome MV3 manifest and extension assets.
3. Implement the side panel UI in React/TypeScript with interval input, start/stop buttons, status indicator, and logs.
4. Implement a background service worker that manages the polling lifecycle using an offscreen document for reliable sub-minute intervals and message handling.
5. Implement a content script on `seller.indiamart.com` that performs `getBLDisplayData`, extracts `glusrid`, saves it to storage, and returns API results.
6. Add fallback logic for missing `glusrid`: navigate/reload the page, intercept the API call/request payload, extract `GLID` from the request rather than relying on the `BINDED` header value, and store it locally.
7. Persist timer state and last interval in `chrome.storage.local` so status survives quick service worker restarts.
8. Add error handling for invalid intervals, no seller tab, session expiry, network issues, bad API response, and missing glusrid.
9. Verify manually on `seller.indiamart.com`, including start/stop, polling intervals, logs, and error recovery.

**Relevant files to create**
- `manifest.json` — MV3 config, host permissions for `seller.indiamart.com`, side panel registration, `offscreen`, `storage`, `tabs` if needed.
- `package.json` — React + TypeScript + Vite + `@crxjs/vite-plugin` dependencies.
- `tsconfig.json` — TypeScript compiler settings.
- `vite.config.ts` — Vite config for Chrome extension build.
- `src/side-panel/App.tsx` — React UI component for interval, buttons, status, logs.
- `src/side-panel/index.tsx` — Side panel entry.
- `src/background/serviceWorker.ts` — Polling management, offscreen lifecycle, messaging.
- `src/content/contentScript.ts` — Content script on seller page for API calls and glusrid extraction.
- `src/shared/types.ts` — Messaging payload types and response shapes.
- `src/styles.css` or Tailwind config — UI styling.

**Verification**
1. Load the unpacked extension in Chrome and confirm the side panel opens.
2. Enter a valid interval and start polling; confirm first API call happens after the interval.
3. Confirm subsequent calls happen at the configured interval and logs update.
4. Stop polling and verify no additional calls occur.
5. Remove `glusrid` from storage and confirm the extension navigates/reloads to recover it.
6. Confirm session expiry or bad response stops polling and shows an error.
7. Confirm the status remains active even when switching tabs or minimizing Chrome by using an offscreen document.

**Decisions**
- Build as a Chrome Manifest V3 extension using React + TypeScript + Vite, matching the Specs.
- Treat purchase automation and lead filtering as out of scope for this phase.
- Use an offscreen document rather than `chrome.alarms` for reliable sub-5-second polling.
- Use `chrome.storage.local` for interval and state persistence.

**Further Consideration**
1. Determine whether the extension should persist logs across sessions or only keep them in-memory.
2. Confirm whether the UI should be a Chrome side panel or action popup; Specs explicitly require a side panel.
3. Decide whether to add `cookies` permission for fallback session recovery, or rely on the page context and `glusrid` from API responses.
