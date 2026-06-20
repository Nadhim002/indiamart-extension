# IndiaMart Buy Leads Automation Extension

Chrome MV3 extension for automating buy lead polling from seller.indiamart.com.

## Features

- ✅ Poll `getBLDisplayData` API at user-defined intervals (1-300 seconds)
- ✅ Start/Stop controls from a Chrome side panel
- ✅ Real-time logging of API calls and errors
- ✅ Session detection and error handling
- ✅ Call statistics (total, success, errors)

## Installation (Development)

1. **Open Chrome Extensions Manager**
   - Go to `chrome://extensions/`

2. **Enable Developer Mode**
   - Toggle "Developer mode" (top-right corner)

3. **Load Unpacked Extension**
   - Click "Load unpacked"
   - Select this folder (`indiamart-extension`)

4. **Verify Installation**
   - You should see "IndiaMart Buy Leads Automation" in the extensions list

## Usage

1. **Login to seller.indiamart.com**
   - Navigate to `https://seller.indiamart.com/bltxn/` in a Chrome tab
   - Ensure you're logged in as a seller

2. **Open the Side Panel**
   - Click the extension icon (puzzle piece) in the toolbar
   - Click "IndiaMart Buy Leads Automation"
   - The side panel should open on the right side

3. **Configure and Start**
   - Enter interval (seconds): e.g., `5` for 5-second polling
   - Click **START**
   - The extension will begin polling the API every N seconds
   - Check the logs for API results

4. **Stop Polling**
   - Click **STOP** to halt the timer
   - View statistics and logs

## File Structure

```
indiamart-extension/
├── manifest.json          — MV3 extension manifest
├── service_worker.js      — Background timer and state management
├── side_panel.html        — UI layout
├── side_panel.js          — UI controller
├── content.js             — API caller on seller.indiamart.com
├── styles.css             — Panel styling
├── images/                — Icons (48x48, 128x128)
└── README.md              — This file
```

## Architecture

### Service Worker (`service_worker.js`)
- Manages polling timer (setInterval)
- Tracks call count, success/error stats
- Maintains log buffer (last 100 entries)
- Receives messages from side panel
- Dispatches messages to content script

### Content Script (`content.js`)
- Runs on `seller.indiamart.com` pages
- Calls `POST /blreact/getBLDisplayData` API
- Extracts `glusrid` (seller ID) from page context
- Returns API response to service worker

### Side Panel (`side_panel.html`, `side_panel.js`, `styles.css`)
- User input: interval field (1-300 seconds)
- Start/Stop buttons
- Real-time status and statistics
- Log viewer with auto-scroll
- Error message display

## API Details

### Polling Endpoint
- **URL:** `POST https://seller.indiamart.com/blreact/getBLDisplayData`
- **Auth:** HTTP session cookies (reused via `credentials: 'include'`)
- **Payload:** `getBLDisplayData` request with seller ID, filters, pagination (1-20)
- **Response:** `DisplayList` (array of 20 leads), `Allcount` (total leads available)

### Success Check
```javascript
if (data.CODE === "200" && data.STATUS === "Success") {
  // Success
} else {
  // Error
}
```

## Error Handling

| Error | Behavior |
|-------|----------|
| Invalid interval (< 1 or > 300) | Validation error shown in UI |
| No seller.indiamart.com tab | Warning logged, polling continues |
| Session expired (CODE !== "200") | Polling stops, error message shown |
| Network error | Polling stops, exception logged |
| glusrid not found | Polling stops, error message shown |

## Session Management

- **Session Detection:** Content script extracts `glusrid` from page globals, localStorage, or meta tags
- **Cookie Reuse:** `fetch(..., { credentials: 'include' })` automatically includes session cookies
- **Expiry Handling:** If API returns error code, polling pauses and user is prompted to re-login

## Future Enhancements (Phase 2+)

- [ ] Lead filtering (city, credits, category)
- [ ] Automatic lead purchasing (`contactBuyNow`)
- [ ] Balance checking (`getBuyLeadBalanceData`)
- [ ] Result visualization (table, charts)
- [ ] Configuration persistence
- [ ] Multi-tab polling
- [ ] Scheduled polling (weekdays/hours)
- [ ] Notification alerts

## Troubleshooting

### Panel doesn't open
- Ensure extension is loaded in `chrome://extensions/`
- Try refreshing the seller.indiamart.com page
- Check Chrome console for errors (Ctrl+Shift+J)

### API calls fail immediately
- Verify you're logged into seller.indiamart.com
- Check if glusrid is extracted correctly (inspect page with DevTools)
- Try manually calling the API in browser console to test session

### Logs show "No active tab found"
- Ensure a tab with `seller.indiamart.com` URL is open
- Try clicking anywhere on the page to ensure tab is active

### Session expired error
- Navigate to `seller.indiamart.com` in your browser
- Complete re-login
- Return to the side panel and click START again

## Testing Checklist

- [ ] Extension loads without manifest errors
- [ ] Side panel opens when extension icon clicked
- [ ] Interval input accepts 1-300 and rejects invalid values
- [ ] START button begins polling and logs first call within interval+1s
- [ ] Subsequent calls fire at correct intervals (e.g., 5s)
- [ ] STOP button immediately halts timer
- [ ] Statistics (call count, success, errors) update in real-time
- [ ] Logs display with timestamps and color-coding (INFO/WARN/ERROR)
- [ ] Error messages appear and fade after 5 seconds
- [ ] Multiple start/stop cycles don't leak memory or timers

## Development Notes

### Enable Debug Logging
- Open `chrome://extensions/`
- Find this extension and click "Details"
- Enable "Allow in Incognito" (optional)
- Service Worker: inspect with "Service worker" link
- Content Script: inspect with site's DevTools

### Monitor Background Script
- Open `chrome://extensions/`
- Find this extension
- Click "Inspect views > service_worker.html"
- Check console and network tabs for API calls

### Manifest Changes
- After editing `manifest.json`, reload the extension:
  - Go to `chrome://extensions/`
  - Click reload button on this extension card

## License

Internal use only. Do not distribute without permission.

## Support

For issues or feature requests, contact development team.
