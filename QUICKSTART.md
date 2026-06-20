# Quick Start Guide

## Installation (1 min)

1. Open Chrome and go to `chrome://extensions/`
2. Toggle **Developer mode** (top-right corner)
3. Click **Load unpacked**
4. Select this folder: `c:\Users\ADMIN\Downloads\indiamart-extension`
5. ✅ You should see the extension appear in the list

## Testing (5-10 min)

### Step 1: Open seller.indiamart.com
- Go to https://seller.indiamart.com/bltxn/?pref=recent
- **Important:** You must be logged in as a seller

### Step 2: Open the Side Panel
- Click the **puzzle icon** (extensions) in Chrome toolbar
- Find **IndiaMart Buy Leads Automation**
- Click it to open the side panel on the right

### Step 3: Start Polling
1. Enter interval: `5` (5 seconds)
2. Click **START**
3. Watch the logs — you should see:
   - `[HH:MM:SS] INFO — Polling started: interval 5s`
   - `[HH:MM:SS] INFO — getBLDisplayData OK: 20 leads, total=186`
   - (repeating every 5 seconds)

### Step 4: Verify Statistics
- **Calls made:** Should increment every 5 seconds
- **Success:** Should match or be close to calls made
- **Last call:** Should show recent timestamp

### Step 5: Stop Polling
- Click **STOP**
- Should see: `Polling stopped (User stopped). Total calls made: X`
- Polling halts immediately

## Success Criteria

✅ Panel opens without errors  
✅ START button validates interval (reject < 1 or > 300)  
✅ First API call fires within 5-6 seconds of clicking START  
✅ Subsequent calls happen every 5 seconds (no early/late calls)  
✅ STOP button immediately halts polling  
✅ Logs show timestamps and are color-coded (blue INFO, orange WARN, red ERROR)  
✅ Statistics update in real-time  
✅ No JavaScript errors in Chrome DevTools  

## Debugging

### Check DevTools

#### Content Script Errors
1. Right-click on seller.indiamart.com page → **Inspect**
2. Go to **Console** tab
3. Should show: `IndiaMart Buy Leads - Content Script loaded`
4. Watch for errors here when polling runs

#### Service Worker Errors
1. Go to `chrome://extensions/`
2. Find this extension, click **Details**
3. Under "Service worker," click **Inspect**
4. Check **Console** for logs and errors
5. Service worker logs appear with timestamps

#### Network Requests
1. Inspect the seller.indiamart.com page
2. Go to **Network** tab
3. Filter by `Fetch/XHR`
4. Look for requests to `/blreact/getBLDisplayData`
5. Verify they return `200` status and JSON response with `CODE: "200"`

### Common Issues

#### Panel doesn't open
- [ ] Extension loaded in chrome://extensions/ ?
- [ ] Refresh seller.indiamart.com page
- [ ] Try opening Chrome DevTools → check for errors

#### "Could not identify seller (glusrid)"
- [ ] Are you logged in to seller.indiamart.com ?
- [ ] Navigate to https://seller.indiamart.com/bltxn/ first
- [ ] Try refreshing the page

#### "Session expired" after first call
- [ ] Re-login to seller.indiamart.com in your browser
- [ ] Refresh the BuyLeads page
- [ ] Click START again in the panel

#### Calls aren't firing
- [ ] Check that interval is numeric and ≥ 1
- [ ] Verify a tab with seller.indiamart.com is open
- [ ] Check service worker console for errors

## File Overview

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 configuration, permissions |
| `service_worker.js` | Background timer and state |
| `side_panel.html` | UI layout |
| `side_panel.js` | UI controller, messaging |
| `content.js` | API caller (on seller.indiamart.com) |
| `styles.css` | Panel styling |
| `README.md` | Full documentation |

## What Happens Behind the Scenes

1. **User clicks START**
   - Panel sends message: `{ action: 'start_polling', interval_seconds: 5 }`

2. **Service Worker starts timer**
   - `setInterval(callGetBLDisplayData, 5000)` runs every 5 seconds

3. **Timer fires**
   - Service worker finds active seller.indiamart.com tab
   - Sends message to content script: `{ action: 'fetch_bldisplaydata' }`

4. **Content Script calls API**
   - Extracts seller ID (`glusrid`) from page
   - Calls `fetch('/blreact/getBLDisplayData', { credentials: 'include' })`
   - Returns response to service worker

5. **Service Worker logs result**
   - On success: increment counter, log "OK: 20 leads"
   - On error: log error, stop polling

6. **Panel updates**
   - Every 500ms, panel polls service worker for latest state
   - UI updates with call count, timestamp, logs

## Next Steps

Once you verify the MVP works:

- [ ] **Phase 2:** Add lead filtering (city, credits, category)
- [ ] **Phase 3:** Add automatic lead purchasing (`contactBuyNow`)
- [ ] **Phase 4:** Add balance checking (`getBuyLeadBalanceData`)
- [ ] **Phase 5:** Add UI visualization (table of leads)

## Support

- Check Chrome console for errors (DevTools → Console)
- Inspect service worker (chrome://extensions/ → Details → Inspect service worker)
- Review logs in the side panel
- Check this guide's Debugging section

Good luck! 🚀
