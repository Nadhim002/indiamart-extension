import { useState } from 'react';
import { Button } from '@/components/ui/button';
import DeviceList from '@/components/DeviceList';
import type { DeviceView } from '@/hooks/useAccountDevices';
import { sendRealLeadTest, deleteDummyLeads } from '@/lib/testNotification';

interface MyDevicesProps {
  computers: DeviceView[];
  phones: DeviceView[];
  maxComputers: number;
  maxPhones: number;
  onRename: (kind: 'computer' | 'phone', id: string, name: string) => void;
  onRemove: (kind: 'computer' | 'phone', id: string) => void;
}

const REASON_TEXT: Record<string, string> = {
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

  const runTest = async () => {
    setBusy(true);
    setStatus('Sending…');
    try {
      const result = await sendRealLeadTest();
      setStatus(
        result.ok
          ? '✓ Sent — check your phone'
          : REASON_TEXT[result.reason ?? ''] ?? 'Test failed.'
      );
    } catch (e) {
      // Never leave the button stuck on "Sending…" — surface the failure instead.
      console.error('[Test] send threw:', e);
      setStatus('Test failed — could not send. See console for details.');
    } finally {
      setBusy(false);
    }
  };

  const runDeleteDummyLeads = async () => {
    const confirmed = window.confirm(
      "Delete all dummy test leads from DataBase and the connected sheet? This can't be undone."
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus('Deleting…');
    try {
      const result = await deleteDummyLeads();
      const parts: string[] = [];
      if (result.firebaseDeleted !== null) parts.push(`${result.firebaseDeleted} from DataBase`);
      if (result.sheetsDeleted !== null) parts.push(`${result.sheetsDeleted} from Sheets`);
      const summary = parts.length > 0 ? `Deleted ${parts.join(', ')}.` : 'Nothing deleted.';
      const suffix = result.errors.length > 0 ? ` (${result.errors.join(' ')})` : '';
      setStatus(summary + suffix);
    } catch (e) {
      console.error('[Cleanup] delete dummy leads threw:', e);
      setStatus('Delete failed — see console for details.');
    } finally {
      setBusy(false);
    }
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
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => runTest()}>
              Test notification
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={busy}
              onClick={() => runDeleteDummyLeads()}
            >
              Delete dummy leads
            </Button>
          </div>
          {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}
        </div>
      )}
    </section>
  );
}
