import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TimerControlsProps {
  inputSeconds: string;
  setInputSeconds: (value: string) => void;
  phoneNumber: string;
  setPhoneNumber: (value: string) => void;
  testMode: boolean;
  setTestMode: (value: boolean) => void;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

export default function TimerControls({
  inputSeconds,
  setInputSeconds,
  phoneNumber,
  setPhoneNumber,
  testMode,
  setTestMode,
  isRunning,
  onStart,
  onStop,
  onReset,
}: TimerControlsProps) {
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="seconds">Interval (sec)</Label>
        <Input
          id="seconds"
          type="number"
          min="1"
          value={inputSeconds}
          onChange={(e) => setInputSeconds(e.target.value)}
          disabled={isRunning}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phoneNumber">Mobile number</Label>
        <Input
          id="phoneNumber"
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          disabled={isRunning}
          placeholder="e.g. 9842142030"
        />
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-input px-3 py-2">
        <span>
          <span className="block text-sm font-medium">Enable auto-purchase</span>
          <span className="block text-xs text-muted-foreground">
            Off = notify only. On = buy matching leads with your IndiaMART balance.
          </span>
        </span>
        <input
          type="checkbox"
          checked={!testMode}
          onChange={(e) => setTestMode(!e.target.checked)}
          disabled={isRunning}
          className="h-4 w-4 accent-primary"
        />
      </label>

      {!testMode && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Auto-purchase is ON. Leads that match your filters will be purchased
          automatically on IndiaMART using your account balance — no per-lead
          confirmation. Turn off "Enable auto-purchase" above to preview matches
          without buying.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button onClick={onStart} disabled={isRunning}>
          Start
        </Button>
        <Button variant="destructive" onClick={onStop} disabled={!isRunning}>
          Stop
        </Button>
        <Button variant="ghost" className="col-span-2" onClick={onReset}>
          Reset
        </Button>
      </div>
    </section>
  );
}
