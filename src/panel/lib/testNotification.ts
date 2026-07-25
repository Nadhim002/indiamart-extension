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

  let sent = 0;
  await Promise.all(
    registeredDevices.map(async ({ token, notificationStyle }) => {
      const expoMessage = buildExpoMessage({
        token,
        notificationStyle,
        title: mockLead.title,
        body: testBody,
        payload: mockLead,
      });
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(expoMessage),
        });
        const data = await res.json();
        const ticket = (data as { data?: { status?: string; message?: string; details?: unknown } })?.data;
        if (ticket?.status === 'error') {
          console.warn('[Test] Expo rejected', token.slice(0, 30) + '...', ticket.message, ticket.details);
        } else {
          sent += 1;
          const isPhonecall = notificationStyle === 'phonecall';
          console.log('[Test] Sent', token.slice(0, 30) + '...', isPhonecall ? 'phonecall(data-only)' : 'banner');
        }
      } catch (e) {
        // Per-device catch so one dead token / failure can't sink the batch.
        console.error('[Test] send failed for', token.slice(0, 20), e);
      }
    })
  );
  // ok if at least one device got the push; otherwise report a send failure
  // (the most common cause was CORS before exp.host was added to host_permissions).
  return sent > 0 ? { ok: true } : { ok: false, reason: 'send-failed' };
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
