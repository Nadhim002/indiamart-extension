import { RefreshCw, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDriveSync } from '@/hooks/useDriveSync';
import { describeSyncResult } from '@/lib/driveSync';

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

// Surfaces the lead-history sync to the user's own Google Drive: last-sync
// time, how many recorded leads are still unsynced, a manual "Sync now", and
// a link to the auto-created "IndiaMART Lead History" sheet. The sync itself
// also runs unattended (a 24h alarm, plus an on-open staleness check) — this
// is just visibility into that, not the only way it happens.
export default function DriveSyncExport() {
  const { status, lastDriveSyncAt, unsyncedCount, historySpreadsheetUrl, error, busy, lastResult, sync } =
    useDriveSync();

  // The outcome of this session's last manual click takes priority — it's
  // what the user just asked for. Absent that, fall back to the ambient
  // state's error (e.g. a background/periodic sync that failed while the
  // panel was closed).
  const feedback = lastResult
    ? describeSyncResult(lastResult)
    : status === 'error' && error
      ? { ok: false, text: `Sync failed: ${error}` }
      : null;

  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-medium text-foreground">Lead history (Drive)</h2>

      <p className="text-sm text-muted-foreground" title={formatAbsolute(lastDriveSyncAt)}>
        {formatLastSync(lastDriveSyncAt)}
        {unsyncedCount != null && unsyncedCount > 0 && ` · ${unsyncedCount} unsynced`}
      </p>

      {feedback && (
        <p
          className={cn('flex items-center gap-1.5 text-xs', feedback.ok ? 'text-emerald-600' : 'text-destructive')}
          role={feedback.ok ? 'status' : 'alert'}
        >
          {feedback.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
          {feedback.text}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={busy || status === 'syncing'}
          onClick={() => sync()}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', (busy || status === 'syncing') && 'animate-spin')} />
          {status === 'syncing' ? 'Syncing…' : 'Sync now'}
        </Button>
        {historySpreadsheetUrl && (
          <Button variant="outline" size="icon" asChild aria-label="Open lead history sheet">
            <a href={historySpreadsheetUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Every lead this extension has seen is synced to a private "IndiaMART Lead History" sheet in
        your own Google Drive — for your records, and available for future analytics. Header row is
        protected as a safeguard against accidental edits, but as the file's owner you can still edit
        or unprotect it.
      </p>
    </section>
  );
}
