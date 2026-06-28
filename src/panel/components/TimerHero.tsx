interface TimerHeroProps {
  timeLeft: number;
  isRunning: boolean;
  formatTime: (seconds: number) => string;
}

export default function TimerHero({ timeLeft, isRunning, formatTime }: TimerHeroProps) {
  return (
    <section className="flex flex-col items-center gap-2 py-2">
      <div className="text-[2.5rem] font-semibold tabular-nums leading-none text-foreground">
        {formatTime(timeLeft)}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            isRunning ? 'animate-pulse-dot bg-success' : 'bg-muted-foreground/40'
          }`}
          aria-hidden="true"
        />
        <span>{isRunning ? 'Running' : 'Stopped'}</span>
      </div>
    </section>
  );
}
