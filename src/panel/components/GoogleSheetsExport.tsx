import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGoogleSheetsSettings } from '@/hooks/useGoogleSheetsSettings';

export default function GoogleSheetsExport() {
  const { sheetUrl, setSheetUrl, sheetTabName, setSheetTabName, connected, connect } =
    useGoogleSheetsSettings();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    setBusy(true);
    setStatus('Connecting…');
    try {
      const result = await connect();
      setStatus(result.ok ? '✓ Connected' : result.reason ?? 'Connect failed.');
    } catch (e) {
      console.error('[Sheets] connect threw:', e);
      setStatus('Connect failed — see console for details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 space-y-4">
      <h2 className="text-sm font-medium text-foreground">Google Sheets export</h2>

      <div className="space-y-2">
        <Label htmlFor="sheetUrl">Sheet URL</Label>
        <Input
          id="sheetUrl"
          type="url"
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sheetTabName">Tab name</Label>
        <Input
          id="sheetTabName"
          type="text"
          value={sheetTabName}
          onChange={(e) => setSheetTabName(e.target.value)}
          placeholder="e.g. Leads"
        />
      </div>

      <div className="space-y-2">
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => handleConnect()}>
          {connected ? 'Reconnect Google Sheets' : 'Connect Google Sheets'}
        </Button>
        {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}
      </div>
    </section>
  );
}
