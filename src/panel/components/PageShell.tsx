import type { ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
  centered?: boolean;
}

export default function PageShell({ children, centered = false }: PageShellProps) {
  return (
    <main
      className={
        centered
          ? 'flex min-h-screen flex-col items-center justify-center px-12 py-12'
          : 'min-h-screen px-5 py-5'
      }
    >
      <div className={centered ? 'w-full max-w-[280px]' : 'mx-auto w-full max-w-[400px]'}>
        {children}
      </div>
    </main>
  );
}
