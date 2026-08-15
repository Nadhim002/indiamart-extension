import { useState } from 'react';
import type { User } from 'firebase/auth/web-extension';
import { RefreshCw, ExternalLink, CheckCircle2, XCircle, FilePlus2, FolderOpen } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDriveSync } from '@/hooks/useDriveSync';
import { useHistorySheetSettings } from '@/hooks/useHistorySheetSettings';
import { describeSyncResult, describeSyncReason } from '@/lib/driveSync';
import { describePickFailure } from '@/lib/picker';
import { LEAD_HISTORY_HEADER_ROW } from '@shared/leadHistoryPayload';

function formatLastSync(ms: number | null): string {
  if (!ms) return 'Never synced';
  const diffMin = Math.round((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'Synced just now';
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Synced ${diffH}h ago`;
  return `Synced ${Math.round(diffH / 24)}d ago`;
}

function formatAbsolute(ms: number | null): string | undefined {
  return ms ? new Date(ms).toLocaleString() : undefined;
}

// Changing the destination clears every syncedAt marker so the full history is
// re-sent into the new sheet. That's deliberate — the alternative leaves two
// partial logs — but it isn't free, so switching always confirms first.
// Connecting for the first time replaces nothing and is never gated.
function confirmSwitch(action: string): boolean {
  return window.confirm(
    [
      `${action}\n`,
      'This changes the lead history sheet for ALL your computers.',
      '',
      'Your entire lead history will be re-synced into it, so this may take a while.',
      '',
      'The current sheet keeps its rows and stays in your Drive.',
      '',
      'Continue?',
    ].join('\n')
  );
}

// Mirrors GoogleSheetsExport: the panel owns the sheet pointer (via
// useHistorySheetSettings, which subscribes to RTDB directly) while the worker
// owns the sync itself (useDriveSync). Nothing is ever created without an
// explicit click — the sheet used to be created by the sync, which is how a
// failed lookup turned into a duplicate spreadsheet on every computer.
export default function DriveSyncExport({ googleUser }: { googleUser: User }) {
  const {
    spreadsheetId,
    spreadsheetName,
    sheetTabName,
    selectTab,
    tabs,
    tabsLoading,
    tabsError,
    syncError,
    sharedSource,
    configState,
    headerStatus,
    connected,
    ready,
    refreshTabs,
    createSheet,
    pickSheet,
  } = useHistorySheetSettings(googleUser);
  const { status, lastDriveSyncAt, unsyncedCount, error, busy, lastResult, sync, refresh } =
    useDriveSync();

  const [sheetStatus, setSheetStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const disabled = working || busy || status === 'syncing';

  const run = async (
    action: () => Promise<{ ok: boolean; reason?: string }>,
    pending: string
  ) => {
    setWorking(true);
    setSheetStatus(pending);
    try {
      const result = await action();
      setSheetStatus(result.ok ? null : describePickFailure(result.reason));
      if (result.ok) refresh();
    } catch (e) {
      console.error('[History] sheet change threw:', e);
      setSheetStatus('Failed — see console for details.');
    } finally {
      setWorking(false);
    }
  };

  const handleCreate = () => {
    if (connected && !confirmSwitch('Create a new lead history sheet?')) return;
    void run(createSheet, 'Creating sheet…');
  };

  const handlePick = () => {
    if (connected && !confirmSwitch('Use an existing spreadsheet for lead history?')) return;
    void run(pickSheet, 'Opening picker…');
  };

  // The outcome of this session's last manual click takes priority — it's what
  // the user just asked for. Absent that, fall back to the ambient state's
  // error (e.g. a background sync that failed while the panel was closed).
  const feedback = lastResult
    ? describeSyncResult(lastResult)
    : status === 'error' && error
      ? { ok: false, text: describeSyncReason(error, error) }
      : null;

  return (
    <section className="mt-6 space-y-4">
      <h2 className="text-sm font-medium text-foreground">Lead history (Drive)</h2>

      {/* Does the ACCOUNT have a sheet? Read from the shared node, not this
          device's copy, so a second computer reports the truth immediately. */}
      {configState === 'checking' ? (
        <p className="text-sm text-muted-foreground">Checking your account for a history sheet…</p>
      ) : configState === 'none' ? (
        <div className="space-y-1">
          <p className="text-sm text-foreground">No history sheet set up yet.</p>
          <p className="text-xs text-muted-foreground">
            Create one or choose an existing sheet below to start pushing your lead history.
            {unsyncedCount != null && unsyncedCount > 0 && (
              <> Nothing is lost meanwhile — {unsyncedCount} lead{unsyncedCount === 1 ? '' : 's'} are
              already recorded and will be pushed on the first sync.</>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm text-foreground">
            Logging to <span className="font-medium">{spreadsheetName || 'your history sheet'}</span>
          </p>
          {sharedSource && (
            <p className="text-xs text-muted-foreground">Synced from another computer</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="historyTabName">Tab name</Label>
        <div className="flex gap-2">
          <select
            id="historyTabName"
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
            Select a tab to enable lead history sync.
          </p>
        )}
        {!tabsError && sheetTabName && headerStatus === 'mismatch' && (
          <p className="text-xs text-amber-600" role="alert">
            This tab's header row doesn't match the expected columns — rows may land misaligned.
            Expected: {LEAD_HISTORY_HEADER_ROW.join(', ')}.
          </p>
        )}
        {!tabsError && sheetTabName && headerStatus === 'empty' && (
          <p className="text-xs text-muted-foreground" role="status">
            This tab is empty — the header row will be written on the first sync.
          </p>
        )}
      </div>

      <p className="text-sm text-muted-foreground" title={formatAbsolute(lastDriveSyncAt)}>
        {formatLastSync(lastDriveSyncAt)}
        {unsyncedCount != null && unsyncedCount > 0 && ` · ${unsyncedCount} unsynced`}
      </p>

      {feedback && (
        <p
          className={cn(
            'flex items-start gap-1.5 text-xs',
            feedback.ok ? 'text-emerald-600' : 'text-destructive'
          )}
          role={feedback.ok ? 'status' : 'alert'}
        >
          {feedback.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          {feedback.text}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={disabled || !ready}
          onClick={() => sync()}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', status === 'syncing' && 'animate-spin')} />
          {status === 'syncing' ? 'Syncing…' : 'Sync now'}
        </Button>
        {spreadsheetId && (
          <Button variant="outline" size="icon" asChild aria-label="Open lead history sheet">
            <a
              href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={handleCreate}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {connected ? 'New sheet' : 'Create sheet'}
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={handlePick}>
          <FolderOpen className="mr-2 h-4 w-4" />
          {connected ? 'Change sheet' : 'Choose existing'}
        </Button>
      </div>

      {sheetStatus && (
        <p className="text-xs text-muted-foreground" role="status">
          {sheetStatus}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Every lead this extension has seen — matched, rejected, or bought — is recorded locally and
        pushed to a Google Sheet you choose. Nothing is created automatically, and nothing is lost
        while no sheet is set up: recorded leads queue and are pushed on the first sync.
      </p>
    </section>
  );
}
