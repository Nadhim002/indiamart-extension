import { MoreVertical, Download, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PageHeaderProps {
  email: string | null;
  deviceCount: number;
  onExportCSV: () => void;
  onSignOut: () => void;
}

export default function PageHeader({ email, deviceCount, onExportCSV, onSignOut }: PageHeaderProps) {
  const phoneLabel = `${deviceCount} phone${deviceCount !== 1 ? 's' : ''}`;

  return (
    <header className="flex items-start justify-between gap-3 pb-6">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-foreground">Indiamart Lead Notifier</h1>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {email} · {phoneLabel}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onExportCSV}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
