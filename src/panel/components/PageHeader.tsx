interface PageHeaderProps {
  email: string | null;
  deviceCount: number;
}

export default function PageHeader({ email, deviceCount }: PageHeaderProps) {
  const phoneLabel = `${deviceCount} phone${deviceCount !== 1 ? 's' : ''}`;

  return (
    <header className="pb-4">
      <h1 className="text-lg font-semibold text-foreground">Indiamart Lead Notifier</h1>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {email} · {phoneLabel}
      </p>
    </header>
  );
}
