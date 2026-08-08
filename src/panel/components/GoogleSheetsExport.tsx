import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGoogleSheetsSettings } from '@/hooks/useGoogleSheetsSettings';

export default function GoogleSheetsExport() {
  const { spreadsheetName, sheetTabName, setSheetTabName, connected, pickSheet } =
    useGoogleSheetsSettings();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePick = async () => {
    setBusy(true);
    setStatus('Opening picker…');
    try {
      const result = await pickSheet();
      setStatus(result.ok ? null : result.reason ?? 'Pick failed.');
    } catch (e) {
      console.error('[Sheets] pick threw:', e);
      setStatus('Pick failed — see console for details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 space-y-4">
      <h2 className="text-sm font-medium text-foreground">Google Sheets export</h2>

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
        {connected && (
          <p className="text-sm text-foreground">
            Exporting to <span className="font-medium">{spreadsheetName}</span>
          </p>
        )}
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => handlePick()}>
          {connected ? 'Change sheet' : 'Choose sheet'}
        </Button>
        {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}
      </div>
    </section>
  );
}
