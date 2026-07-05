import { buildExpoMessage } from '@shared/pushPayload';

export interface TestResult {
  ok: boolean;
  reason?: string;
}

// "Mock lead" test: fires a fully fabricated lead to every registered phone,
// using the exact same message shape as production (@shared/pushPayload). No
// checks, no IndiaMART fetch — just proves the Expo push reaches the phone.
export async function sendMockTestNotification(): Promise<TestResult> {
  const { registeredDevices = [] } = await new Promise<{
    registeredDevices?: Array<{ token: string; notificationStyle: string }>;
  }>((resolve) => chrome.storage.local.get(['registeredDevices'], resolve));

  if (registeredDevices.length === 0) {
    return { ok: false, reason: 'no-phone' };
  }

  const mockLead = {
    title: 'Test Lead — Mock Purchase',
    buyerName: 'Test User',
    buyerMobile: '9000000000',
    quantity: '100',
    city: 'Mumbai',
    state: 'Maharashtra',
  };
  const testBody = 'Buyer: Test User — Mumbai, Maharashtra';

  await Promise.all(
    registeredDevices.map(async ({ token, notificationStyle }) => {
      const expoMessage = buildExpoMessage({
        token,
        notificationStyle,
        title: mockLead.title,
        body: testBody,
        payload: mockLead,
      });
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expoMessage),
      });
      const data = await res.json();
      const isPhonecall = notificationStyle === 'phonecall';
      console.log('[Test] Expo response:', data, isPhonecall ? 'phonecall(data-only)' : 'banner');
    })
  );
  return { ok: true };
}

// "Real lead" test: asks the service worker to run a real one-shot fetch against
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
