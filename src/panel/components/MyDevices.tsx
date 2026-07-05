import { Button } from '@/components/ui/button';
import DeviceList from '@/components/DeviceList';
import type { DeviceView } from '@/hooks/useAccountDevices';

interface MyDevicesProps {
  computers: DeviceView[];
  phones: DeviceView[];
  maxComputers: number;
  maxPhones: number;
  onRename: (kind: 'computer' | 'phone', id: string, name: string) => void;
  onRemove: (kind: 'computer' | 'phone', id: string) => void;
  onTestNotification: () => void;
}

export default function MyDevices({
  computers,
  phones,
  maxComputers,
  maxPhones,
  onRename,
  onRemove,
  onTestNotification,
}: MyDevicesProps) {
  return (
    <section className="mt-6 space-y-4">
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">
          Computers <span className="text-muted-foreground">({computers.length}/{maxComputers})</span>
        </h2>
        <DeviceList devices={computers} onRename={onRename} onRemove={onRemove} />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">
          Phones <span className="text-muted-foreground">({phones.length}/{maxPhones})</span>
        </h2>
        <DeviceList devices={phones} onRename={onRename} onRemove={onRemove} />
      </div>

      {phones.length > 0 && (
        <Button variant="outline" className="w-full" onClick={onTestNotification}>
          Send test notification
        </Button>
      )}
    </section>
  );
}
