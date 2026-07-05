import { useState } from 'react';
import { Button } from '@/components/ui/button';
import DeviceList from '@/components/DeviceList';
import type { DeviceView } from '@/hooks/useAccountDevices';
import { sendMockTestNotification, sendRealLeadTest } from '@/lib/testNotification';

interface MyDevicesProps {
  computers: DeviceView[];
  phones: DeviceView[];
  maxComputers: number;
  maxPhones: number;
  onRename: (kind: 'computer' | 'phone', id: string, name: string) => void;
  onRemove: (kind: 'computer' | 'phone', id: string) => void;
}

const REASON_TEXT: Record<string, string> = {
  'no-phone': 'No registered phone to notify.',
  'no-tab': 'Open your IndiaMART leads page and try again.',
  'not-signed-in': 'Not signed in.',
  'fetch-failed': "Couldn't reach IndiaMART — open your leads page and retry.",
  'no-lead': 'No leads found on your IndiaMART page.',
};

export default function MyDevices({
  computers,
  phones,
  maxComputers,
  maxPhones,
  onRename,
  onRemove,
}: MyDevicesProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runTest = async (kind: 'mock' | 'real') => {
    setBusy(true);
    setStatus('Sending…');
    const result = kind === 'mock' ? await sendMockTestNotification() : await sendRealLeadTest();
    setStatus(
      result.ok
        ? '✓ Sent — check your phone'
        : REASON_TEXT[result.reason ?? ''] ?? 'Test failed.'
    );
    setBusy(false);
  };

  return (
    <section className="mt-6 space-y-4">
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">
          Computers <span className="text-muted-foreground">({computers.length}/{maxComputers})</span>
        </h2>
        <DeviceList devices={computers} onRename={onRename} onRemove={onRemove} />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">
          Phones <span className="text-muted-foreground">({phones.length}/{maxPhones})</span>
        </h2>
        <DeviceList devices={phones} onRename={onRename} onRemove={onRemove} />
      </div>

      {phones.length > 0 && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => runTest('mock')}>
              Test with mock lead
            </Button>
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => runTest('real')}>
              Test with real lead
            </Button>
          </div>
          {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}
        </div>
      )}
    </section>
  );
}
