# IndiaMart Buy Leads Automation Extension — Specification

## 1. Overview

**Project:** IndiaMart Buy Leads Automation Extension (Chrome MV3)

**Purpose:** Automate the polling of buy lead listings from `seller.indiamart.com/bltxn/` API (`getBLDisplayData`) at user-defined intervals, enabling continuous monitoring of incoming leads.

**Scope (MVP):** 
- Poll `getBLDisplayData` API on a configurable timer (seconds)
- Start/Stop control from a Chrome side panel
- Log polling activity and errors
- No lead filtering, purchase automation, or result display yet

**Status:** Spec only — no implementation

---

## 2. Architecture

### High-Level Components

```
Chrome Extension (MV3)
├── manifest.json           — Permissions, side panel config
├── service_worker.js       — Background logic, interval management
├── side_panel.html         — UI (interval input, start/stop buttons)
├── side_panel.js           — Panel controller, message handling
├── content.js              — API caller on seller.indiamart.com
└── styles.css              — Panel styling
```

### Execution Context

| Component         | Context                                    | Responsibilities                                                    |
|-------------------|--------------------------------------------|---------------------------------------------------------------------|
| **Content Script** | Runs on `seller.indiamart.com` tabs        | Invoke fetch() to APIs (reuses page session via credentials:include) |
| **Service Worker** | Background (persistent across tabs)        | Manage poll timer state, dispatch messages to content script         |
| **Side Panel**    | Foreground UI (user-facing)                | Accept interval input, show start/stop buttons, display status       |

---

## 3. User Interface

### Side Panel Layout

**Dimensions:** ~350px wide (Chrome default side panel width)

**Components:**

```
┌─────────────────────────────────┐
│  Buy Leads Automation           │
├─────────────────────────────────┤
│                                 │
│  Interval (seconds):            │
│  [____________]  ← input field  │
│  (default: 5)                   │
│                                 │
│  Status: [●] IDLE               │
│                                 │
│  [ START ]  [ STOP ]            │
│             (disabled initially)│
│                                 │
│  Last call: --                  │
│  Calls made: 0                  │
│                                 │
├─────────────────────────────────┤
│ Logs:                           │
│ ─────────────────────────────── │
│ [Clear]                         │
│ Ready to start. Enter interval. │
│                                 │
│                                 │
│                                 │
└─────────────────────────────────┘
```

### UI States

| State  | Description                                    | UI Changes                                       |
|--------|------------------------------------------------|--------------------------------------------------|
| IDLE   | Extension loaded, no polling active            | START enabled; STOP disabled; interval editable |
| ACTIVE | Timer running, API calls happening             | START disabled; STOP enabled; interval read-only |
| ERROR  | API call failed or session expired             | Timer paused; error message shown; STOP enabled  |

---

## 4. Feature Specification

### 4.1 Start Button Behavior

**Trigger:** User clicks "START"

**Preconditions:**
- Interval field is not empty and ≥ 1 second
- User has an active tab open on `seller.indiamart.com/bltxn/` (or any page on that domain where session is valid)

**Action:**
1. Validate interval value
2. Read interval from input field
3. Send `start_polling` message from side panel → service worker
4. Service worker initializes timer (does NOT call API immediately; waits first interval)
5. Update UI state to ACTIVE
6. Disable interval input field
7. Disable START button; enable STOP button
8. Log: `"Polling started: interval {N}s"`

**Outcome:** Timer begins; first API call will fire after `interval` seconds elapse.

---

### 4.2 Stop Button Behavior

**Trigger:** User clicks "STOP"

**Preconditions:**
- Polling is ACTIVE

**Action:**
1. Send `stop_polling` message from side panel → service worker
2. Service worker clears interval
3. Update UI state to IDLE
4. Enable interval input field
5. Enable START button; disable STOP button
6. Log: `"Polling stopped. Total calls made: {N}"`

**Outcome:** Timer halts; no further API calls until START is clicked again.

---

### 4.3 Polling Timer Logic

**In Service Worker:**

```
1. On start_polling message:
   - Clear any existing interval (safety)
   - Extract interval_seconds from message
   - Set intervalId = setInterval(callGetBLDisplayData, interval_seconds * 1000)
   
2. Inside callGetBLDisplayData():
   - Increment call counter
   - Find an active tab on seller.indiamart.com
   - Send fetch_bldisplaydata message → content script on that tab
   - Wait for response
   - On success:
     * Increment success counter
     * Log timestamp + "getBLDisplayData OK: N leads returned"
   - On error:
     * Log error message
     * Send error_polling message → side panel
     * Clear interval
     * Switch UI to ERROR state
     
3. On stop_polling message:
   - clearInterval(intervalId)
   - Reset counters (optional)
   - Log "Polling stopped"
```

---

### 4.4 API Call Details

**From Content Script to seller.indiamart.com API:**

```javascript
// After service worker sends fetch_bldisplaydata message:

const glusrid = extractGlusridFromPage();  // See Session section

const payload = {
  LocPref: "4",
  stateid: "",
  city: "",
  iso: "",
  pref_city_lead: 0,
  glusrid: glusrid,
  inbox: "",
  offer: "",
  offer_type: "B",
  start: 1,
  end: 20,
  UsageTyp: "",
  quantity: "",
  is_email: "",
  is_gst: "",
  is_catalog: "",
  is_mobnum: "",
  is_busname: "",
  mcatid: "",
  sov: "",
  eov: null,
  enqType: ""
};

const response = await fetch('/blreact/getBLDisplayData', {
  method: 'POST',
  credentials: 'include',  // ← Critical: reuses session cookies
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

const data = await response.json();

// Success check:
if (data.CODE === "200" && data.STATUS === "Success") {
  return {
    success: true,
    lead_count: data.DisplayList.length,
    total_leads: data.Allcount,
    timestamp: new Date().toISOString()
  };
} else {
  return {
    success: false,
    error: data.Msg || "Unknown error",
    code: data.CODE,
    timestamp: new Date().toISOString()
  };
}
```

---

### 4.5 Session Handling

**Session Detection:**

The extension assumes the user is logged into `seller.indiamart.com` in the active browser tab. The `glusrid` (seller GL user ID) must be extracted from one of:

1. **Page context:** Extract from analytics payload or seller profile JS variable (if available)
2. **API response history:** Cache from first successful `getBLDisplayData` response
3. **Cookie parsing:** Use `chrome.cookies.getAll()` to inspect session cookies (requires `cookies` permission)

**For MVP:** Content script attempts to extract `glusrid` from page globals or logs error if not found.

**Session Expiry Handling:**

If `getBLDisplayData` returns `CODE !== "200"` or `STATUS !== "Success"`:
- Service worker stops polling
- Side panel shows error: `"Session expired or invalid response. Please refresh the page and try again."`
- User must re-login on `seller.indiamart.com` and click START again

---

## 5. State Management

### Service Worker State

```javascript
// service_worker.js (global scope)

let pollingState = {
  active: false,
  intervalId: null,
  interval_seconds: null,
  call_count: 0,
  success_count: 0,
  error_count: 0,
  last_call_time: null,
  last_error: null
};
```

### Message Protocol

| Direction               | Message Type              | Payload                                          | Response                              |
|------------------------|---------------------------|--------------------------------------------------|---------------------------------------|
| Panel → Service Worker | `start_polling`           | `{ interval_seconds: N }`                        | `{ ok: true }` or error               |
| Panel → Service Worker | `stop_polling`            | `{}`                                             | `{ ok: true, call_count: N }`         |
| Service Worker → Panel | `polling_status_update`   | `{ active, call_count, last_call_time, error }` | (fire-and-forget)                     |
| Service Worker → CS    | `fetch_bldisplaydata`     | `{ glusrid }`                                    | `{ success, lead_count, error }`      |
| Panel → Service Worker | `get_status`              | `{}`                                             | `{ state: {...} }`                    |

---

## 6. Error Handling

### Scenario Matrix

| Error Type                    | Detection                                   | Action                                                                                  | UI Feedback                                         |
|-------------------------------|---------------------------------------------|-----------------------------------------------------------------------------------------|-----------------------------------------------------|
| **Invalid interval**          | Interval < 1 or non-numeric                 | Reject start; show validation error                                                     | "Interval must be ≥ 1 second"                       |
| **No tab found**              | No seller.indiamart.com tab open            | Log warning; skip this call; try next interval                                          | (silent; logged only)                               |
| **Session expired (401/403)** | `CODE !== "200"` or network 401/403         | Stop polling; show error msg; await user re-login                                       | "Session expired. Please re-login and try again."   |
| **Network error**             | fetch() throws                              | Stop polling; show error msg                                                            | "Network error. Check connection."                  |
| **Invalid API response**      | JSON parse error or missing required fields | Stop polling; show error msg                                                            | "Unexpected API response. Try refreshing the page." |
| **glusrid not found**         | Content script cannot extract glusrid       | Stop polling; show error msg                                                            | "Could not identify seller. Please refresh."        |

---

## 7. Logging

### Log Output (in side panel console area)

Each log entry includes **timestamp, level, message**:

```
[07:51:22] INFO — Polling started: interval 5s
[07:51:27] INFO — getBLDisplayData OK: 20 leads, total=186
[07:51:32] INFO — getBLDisplayData OK: 20 leads, total=186
[07:51:37] ERROR — Session expired. Polling paused.
```

**Log storage:** Store last 100 logs in memory (clear on service worker restart).

**Optional:** Persist logs to `chrome.storage.local` for debugging.

---

## 8. Manifest Permissions

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "IndiaMart Buy Leads Automation",
  "version": "0.1.0",
  "description": "Automate buy lead polling",
  "permissions": [
    "tabs",
    "storage",
    "offscreen"
  ],
  "host_permissions": [
    "*://seller.indiamart.com/*"
  ],
  "side_panel": {
    "default_path": "side_panel.html"
  },
  "action": {
    "default_title": "Buy Leads Automation"
  },
  "icons": {
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  }
}
```

---

## 9. Session / Storage

### chrome.storage.local (optional, for persistence)

```javascript
{
  "last_interval": 5,
  "auto_start_next_session": false,
  "logs": [/* last 100 entries */]
}
```

### Runtime data (Service Worker memory)

- Polling state (active, call_count, etc.)
- Current interval
- Recent API responses (last call result)

---

## 10. Testing Checklist

### Unit Tests (TBD after implementation)

- [ ] Start button validates interval input
- [ ] Stop button clears interval
- [ ] Content script extracts glusrid correctly
- [ ] API fetch succeeds with valid session
- [ ] API fetch fails gracefully with invalid session
- [ ] Error states trigger polling pause

### Manual Tests (before release)

- [ ] Panel opens on seller.indiamart.com
- [ ] Interval input accepts numeric values > 0
- [ ] Polling starts and logs first call within interval+1s
- [ ] Subsequent calls fire at correct intervals
- [ ] Stop button halts polling immediately
- [ ] Error message appears on session expiry
- [ ] Logs display correctly and clear when requested
- [ ] Multiple starts/stops don't leak intervals

---

## 11. Not in Scope (Future Phases)

- **Lead filtering** (city, credits, category) — Phase 2
- **Automatic lead purchasing** (`contactBuyNow`) — Phase 3
- **Balance checking** (`getBuyLeadBalanceData`) — Phase 2
- **Result visualization** (table, charts) — Phase 2
- **Configuration persistence** (save filters/interval between sessions) — Phase 2
- **Multi-tab polling** (distribute across multiple tabs) — Phase 3

---

## 12. Success Criteria (MVP)

✅ Extension loads and opens side panel on `seller.indiamart.com`  
✅ User can enter interval (1–300 seconds) and click START  
✅ Timer fires and calls `getBLDisplayData` at specified intervals  
✅ Logs show each API call result (success/error)  
✅ User can click STOP to halt polling  
✅ Session expiry is detected and polling pauses with error message  
✅ No errors in Chrome DevTools console  

---

## 13. Implementation Order (Next Phase)

1. Scaffold manifest.json + folder structure
2. Implement side panel HTML/CSS/JS (interval input, buttons, status area)
3. Implement service worker (timer logic, message handling)
4. Implement content script (fetch wrapper, glusrid extraction)
5. Wire up messaging between components
6. Test polling loop on live seller.indiamart.com session
7. Add error handling and logging
8. Polish UI and logging
