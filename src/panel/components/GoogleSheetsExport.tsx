import { useState } from 'react';
import type { User } from 'firebase/auth/web-extension';
import { RefreshCw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useGoogleSheetsSettings } from '@/hooks/useGoogleSheetsSettings';
import { describePickFailure } from '@/lib/picker';
import { SHEET_HEADER_ROW } from '@shared/sheetsPayload';

export default function GoogleSheetsExport({ googleUser }: { googleUser: User }) {
  const {
    spreadsheetName,
    sheetTabName,
    selectTab,
    tabs,
    tabsLoading,
    tabsError,
    syncError,
    sharedSource,
    refreshTabs,
    headerStatus,
    connected,
    pickSheet,
  } = useGoogleSheetsSettings(googleUser);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePick = async () => {
    // The sheet pointer is shared across every computer on this account, so
    // re-picking here silently redirects the others' exports too.
    if (
      connected &&
      !window.confirm('This changes the sheet for all your computers. Continue?')
    ) {
      return;
    }
    setBusy(true);
    setStatus('Opening picker…');
    try {
      const result = await pickSheet();
      setStatus(result.ok ? null : describePickFailure(result.reason));
    } catch (e) {
      console.error('[Sheets] pick threw:', e);
      setStatus('Pick failed — see console for details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-0 space-y-4">
      <h2 className="text-sm font-medium text-foreground">Google Sheets</h2>

      <div className="space-y-2">
        <Label htmlFor="sheetTabName">Tab name</Label>
        <div className="flex gap-2">
          <select
            id="sheetTabName"
            value={sheetTabName}
            onChange={(e) => selectTab(e.target.value)}
            disabled={!connected || tabsLoading}
            className={cn(
              'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-60'
            )}
          >
            <option value="" disabled>
              {tabsLoading ? 'Loading tabs…' : 'Select a tab…'}
            </option>
            {tabs.map((tab) => (
              <option key={tab} value={tab}>
                {tab}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon"
            disabled={!connected || tabsLoading}
            onClick={() => refreshTabs()}
            aria-label="Refresh tab list"
          >
            <RefreshCw className={cn('h-4 w-4', tabsLoading && 'animate-spin')} />
          </Button>
        </div>
        {tabsError && (
          <p className="text-xs text-destructive" role="alert">
            {tabsError}
          </p>
        )}
        {syncError && (
          <p className="text-xs text-destructive" role="alert">
            {syncError}
          </p>
        )}
        {!tabsError && connected && !tabsLoading && !sheetTabName && (
          <p className="text-xs text-muted-foreground" role="status">
            Select a tab to enable Sheets export.
          </p>
        )}
        {!tabsError && sheetTabName && headerStatus === 'mismatch' && (
          <p className="text-xs text-amber-600" role="alert">
            This tab's header row doesn't match the expected columns — leads may land
            misaligned. Expected: {SHEET_HEADER_ROW.join(', ')}.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {connected && (
          <>
            <p className="text-sm text-foreground">
              Exporting to <span className="font-medium">{spreadsheetName}</span>
            </p>
            {sharedSource && (
              <p className="text-xs text-muted-foreground">Synced from another computer</p>
            )}
          </>
        )}
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => handlePick()}>
          {connected ? 'Change sheet' : 'Choose sheet'}
        </Button>
        {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}
      </div>
    </section>
  );
}
