import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/PageShell';
import { ADMIN_CONTACT_EMAIL } from '@/lib/constants';
import type { EntitlementReason } from '@shared/types';

interface LockoutPageProps {
  reason: EntitlementReason;
  email: string | null;
  onSignOut: () => void;
}

const COPY: Record<EntitlementReason, { title: string; body: string }> = {
  ok: { title: 'Locked', body: 'This account cannot use the extension right now.' },
  'no-account': {
    title: 'No active subscription',
    body: 'This account isn’t activated yet. Contact the admin to get access.',
  },
  expired: {
    title: 'Subscription expired',
    body: 'Your subscription has expired. Contact the admin to renew and continue.',
  },
};

export default function LockoutPage({ reason, email, onSignOut }: LockoutPageProps) {
  const copy = COPY[reason] ?? COPY['no-account'];

  return (
    <PageShell centered>
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">{copy.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
        </div>

        <div className="w-full space-y-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          {email && <p className="truncate">Signed in as {email}</p>}
          <p>
            Contact admin:{' '}
            <a className="text-primary underline" href={`mailto:${ADMIN_CONTACT_EMAIL}`}>
              {ADMIN_CONTACT_EMAIL}
            </a>
          </p>
        </div>

        <Button variant="outline" className="w-full" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </PageShell>
  );
}
