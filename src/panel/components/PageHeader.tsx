import { BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DASHBOARD_URL } from '@/lib/constants';

interface PageHeaderProps {
  email: string | null;
  deviceCount: number;
}

export default function PageHeader({ email, deviceCount }: PageHeaderProps) {
  const phoneLabel = `${deviceCount} phone${deviceCount !== 1 ? 's' : ''}`;

  return (
    <header className="flex items-start justify-between gap-2 pb-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-foreground">Indiamart Lead Notifier</h1>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {email} · {phoneLabel}
        </p>
      </div>
      {/* Lives in the header, not in a tab: this header is the only thing on
          screen no matter which tab is open, so the dashboard is always one
          click away instead of something the seller has to know the URL for. */}
      <Button variant="outline" size="sm" asChild className="shrink-0">
        <a href={DASHBOARD_URL} target="_blank" rel="noreferrer">
          <BarChart3 className="mr-1.5 h-4 w-4" />
          Insights
        </a>
      </Button>
    </header>
  );
}
