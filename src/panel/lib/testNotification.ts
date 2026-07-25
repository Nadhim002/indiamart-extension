export interface TestResult {
  ok: boolean;
  reason?: string;
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
