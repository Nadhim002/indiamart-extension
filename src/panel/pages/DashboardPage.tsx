import type { User } from 'firebase/auth';
import PageHeader from '@/components/PageHeader';
import TimerHero from '@/components/TimerHero';
import TimerControls from '@/components/TimerControls';
import LeadFilters from '@/components/LeadFilters';
import StatusFooter from '@/components/StatusFooter';
import MyDevices from '@/components/MyDevices';
import PageShell from '@/components/PageShell';
import DeviceLimitPage from '@/pages/DeviceLimitPage';
import type { LeadRecord } from '@/types';
import type { Entitlement } from '@shared/types';
import { useSettings } from '@/hooks/useSettings';
import { useTimer } from '@/hooks/useTimer';
import { useAccountDevices } from '@/hooks/useAccountDevices';
import { leadsToCsv } from '@/lib/leadsCsv';

const STATE_OPTIONS = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
  'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

interface DashboardPageProps {
  googleUser: User;
  entitlement: Entitlement;
  onSignOut: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function DashboardPage({ googleUser, entitlement, onSignOut }: DashboardPageProps) {
  const settings = useSettings();
  const timer = useTimer();
  const devices = useAccountDevices(googleUser, entitlement);

  const handleStart = () => {
    const payload = settings.buildStartPayload();
    if (payload) timer.start(payload);
  };

  const handleExportCSV = () => {
    chrome.runtime.sendMessage({ type: 'GET_ALL_LEADS' }, (response: { leads?: LeadRecord[] } = {}) => {
      const leads = response.leads;
      if (!leads || leads.length === 0) {
        alert('No leads recorded yet.');
        return;
      }
      const csv = leadsToCsv(leads);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `indiamart-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  // Entitled, but this computer has no seat: block with the self-service
  // removal screen until a slot is freed (then registration happens on its own).
  if (devices.loaded && !devices.seatAvailable) {
    return (
      <DeviceLimitPage
        computers={devices.computers}
        maxComputers={devices.maxComputers}
        onRename={devices.renameDevice}
        onRemove={devices.removeDevice}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        email={googleUser.email}
        deviceCount={devices.phoneCount}
        onExportCSV={handleExportCSV}
        onSignOut={onSignOut}
      />

      <TimerHero timeLeft={timer.timeLeft} isRunning={timer.isRunning} formatTime={formatTime} />

      <TimerControls
        inputSeconds={settings.inputSeconds}
        setInputSeconds={settings.setInputSeconds}
        phoneNumber={settings.phoneNumber}
        setPhoneNumber={settings.setPhoneNumber}
        testMode={settings.testMode}
        setTestMode={settings.setTestMode}
        isRunning={timer.isRunning}
        onStart={handleStart}
        onStop={timer.stop}
        onReset={timer.reset}
      />

      <LeadFilters
        minPrice={settings.minPrice}
        setMinPrice={settings.setMinPrice}
        minQuantity={settings.minQuantity}
        setMinQuantity={settings.setMinQuantity}
        minTimePassed={settings.minTimePassed}
        setMinTimePassed={settings.setMinTimePassed}
        selectedStates={settings.selectedStates}
        toggleStateSelection={settings.toggleStateSelection}
        stateOptions={STATE_OPTIONS}
        includeKeywords={settings.includeKeywords}
        setIncludeKeywords={settings.setIncludeKeywords}
        excludeKeywords={settings.excludeKeywords}
        setExcludeKeywords={settings.setExcludeKeywords}
        isRunning={timer.isRunning}
      />

      <StatusFooter
        cycleCount={timer.cycleCount}
        isRunning={timer.isRunning}
        activeUrl={timer.activeUrl}
        nextFireTime={timer.nextFireTime}
      />

      <MyDevices
        computers={devices.computers}
        phones={devices.phones}
        maxComputers={devices.maxComputers}
        maxPhones={devices.maxPhones}
        onRename={devices.renameDevice}
        onRemove={devices.removeDevice}
      />
    </PageShell>
  );
}
