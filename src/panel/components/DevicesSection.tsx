import { Button } from '@/components/ui/button';

interface DevicesSectionProps {
  onTestNotification: () => void;
}

export default function DevicesSection({ onTestNotification }: DevicesSectionProps) {
  return (
    <section className="mt-4">
      <Button variant="outline" className="w-full" onClick={onTestNotification}>
        Send test notification
      </Button>
    </section>
  );
}
