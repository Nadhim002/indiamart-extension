export interface TestResult {
  ok: boolean;
  reason?: string;
}

export interface DeleteDummyLeadsResult {
  firebaseDeleted: number | null;
  sheetsDeleted: number | null;
  errors: string[];
}

// Asks the service worker to delete every dummy lead (the fixed placeholder
// buyer "Test Buyer" / 9000000000 that sendRealLeadTest() always writes) from
// Firebase and the currently-connected Sheets tab. `null` for either count
// means that side was skipped (not signed in / no sheet connected), not that
// nothing matched — `errors` explains skips and failures on either side.
export function deleteDummyLeads(): Promise<DeleteDummyLeadsResult> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'DELETE_DUMMY_LEADS' },
      (res: DeleteDummyLeadsResult | undefined) => {
        if (chrome.runtime.lastError || !res) {
          resolve({ firebaseDeleted: null, sheetsDeleted: null, errors: ['message-failed'] });
          return;
        }
        resolve(res);
      }
    );
  });
}

// "Test notification": asks the service worker to run a real one-shot fetch against
// the active IndiaMART tab, take the first lead, and notify with its real
// details but a placeholder buyer (name "Test Buyer", phone 9000000000) — doing
// every step except purchasing. The worker returns { ok, reason }.
export function sendRealLeadTest(): Promise<TestResult> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        resolve({ ok: false, reason: 'no-tab' });
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'TEST_REAL_LEAD', tabId: tab.id, url: tab.url },
        (res: TestResult | undefined) => {
          if (chrome.runtime.lastError || !res) {
            resolve({ ok: false, reason: 'fetch-failed' });
            return;
          }
          resolve(res);
        }
      );
    });
  });
}
