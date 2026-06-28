import { Separator } from '@/components/ui/separator';

function truncateUrl(url: string, maxLength = 40): string {
  if (!url || url.length <= maxLength) return url;
  return `${url.slice(0, maxLength)}…`;
}

interface StatusFooterProps {
  cycleCount: number;
  isRunning: boolean;
  activeUrl: string;
  nextFireTime: number | null;
}

export default function StatusFooter({
  cycleCount,
  isRunning,
  activeUrl,
  nextFireTime,
}: StatusFooterProps) {
  const nextInSeconds = nextFireTime
    ? Math.max(0, Math.ceil((nextFireTime - Date.now()) / 1000))
    : null;

  return (
    <section className="mt-6 space-y-2">
      <Separator />
      <div className="space-y-1 pt-2 text-xs text-muted-foreground">
        <p>
          Cycles: <span className="text-foreground">{cycleCount}</span>
          {nextInSeconds !== null && (
            <>
              {' · '}
              Next in <span className="text-foreground">{nextInSeconds}s</span>
            </>
          )}
          {' · '}
          <span className="text-foreground">{isRunning ? 'Running' : 'Stopped'}</span>
        </p>
        {activeUrl && (
          <p className="truncate" title={activeUrl}>
            {truncateUrl(activeUrl)}
          </p>
        )}
      </div>
    </section>
  );
}
