import { MonitorX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/PageShell';
import DeviceList from '@/components/DeviceList';
import { ADMIN_CONTACT_EMAIL } from '@/lib/constants';
import type { DeviceView } from '@/hooks/useAccountDevices';

interface DeviceLimitPageProps {
  computers: DeviceView[];
  maxComputers: number;
  onRename: (kind: 'computer' | 'phone', id: string, name: string) => void;
  onRemove: (kind: 'computer' | 'phone', id: string) => void;
  onSignOut: () => void;
}

// Shown when the user is entitled but this computer has no seat (all computer
// slots are taken). Self-service: remove one of the listed computers — with its
// last-active time to help pick the stale one — and this device registers
// automatically.
export default function DeviceLimitPage({
  computers,
  maxComputers,
  onRename,
  onRemove,
  onSignOut,
}: DeviceLimitPageProps) {
  return (
    <PageShell>
      <div className="flex flex-col gap-5 py-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <MonitorX className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">
              Device limit reached ({computers.length}/{maxComputers})
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You’ve reached your computer limit. Remove a device below to use this one, or contact
              the admin for more devices.
            </p>
          </div>
        </div>

        <DeviceList devices={computers} onRename={onRename} onRemove={onRemove} />

        <p className="text-center text-xs text-muted-foreground">
          Need more devices? Contact{' '}
          <a className="text-primary underline" href={`mailto:${ADMIN_CONTACT_EMAIL}`}>
            {ADMIN_CONTACT_EMAIL}
          </a>
        </p>

        <Button variant="outline" className="w-full" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </PageShell>
  );
}
