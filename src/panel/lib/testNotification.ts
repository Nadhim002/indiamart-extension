import { buildExpoMessage } from '@shared/pushPayload';

// Fires a mock lead notification to every registered device, using the exact
// same message shape as production (@shared/pushPayload) so the test button
// proves the real path.
export async function sendTestNotification(): Promise<void> {
  const { registeredDevices = [] } = await new Promise<{
    registeredDevices?: Array<{ token: string; notificationStyle: string }>;
  }>((resolve) => chrome.storage.local.get(['registeredDevices'], resolve));

  if (registeredDevices.length === 0) {
    console.warn('[Test] No registered phones');
    return;
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
}
