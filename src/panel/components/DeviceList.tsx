import { useState } from 'react';
import { Monitor, Smartphone, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { relativeTime } from '@/lib/relativeTime';
import type { DeviceView } from '@/hooks/useAccountDevices';

interface DeviceListProps {
  devices: DeviceView[];
  onRename: (kind: 'computer' | 'phone', id: string, name: string) => void;
  onRemove: (kind: 'computer' | 'phone', id: string) => void;
}

function DeviceRow({ device, onRename, onRemove }: { device: DeviceView } & Omit<DeviceListProps, 'devices'>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);

  const Icon = device.kind === 'computer' ? Monitor : Smartphone;

  const commit = () => {
    const next = draft.trim();
    if (next && next !== device.name) onRename(device.kind, device.id, next);
    setEditing(false);
  };

  return (
    <li className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
            className="h-7"
          />
        ) : (
          <>
            <p className="truncate text-sm text-foreground">
              {device.name}
              {device.isThisDevice && (
                <span className="ml-1 text-xs text-primary">· this device</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">Last active {relativeTime(device.lastSeen)}</p>
          </>
        )}
      </div>

      {editing ? (
        <>
          <Button variant="ghost" size="icon" aria-label="Save name" onClick={commit}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Cancel" onClick={() => setEditing(false)}>
            <X className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Rename device"
            onClick={() => {
              setDraft(device.name);
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove device"
            onClick={() => onRemove(device.kind, device.id)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      )}
    </li>
  );
}

export default function DeviceList({ devices, onRename, onRemove }: DeviceListProps) {
  if (devices.length === 0) {
    return <p className="text-xs text-muted-foreground">No devices yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {devices.map((d) => (
        <DeviceRow key={`${d.kind}:${d.id}`} device={d} onRename={onRename} onRemove={onRemove} />
      ))}
    </ul>
  );
}
