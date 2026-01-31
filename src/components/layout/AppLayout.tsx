import { ReactNode } from 'react';
import { TopNav } from './TopNav';
import { ModuleNav } from './ModuleNav';

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  moduleNav?: { label: string; href: string }[];
}

export function AppLayout({ children, title, subtitle, moduleNav }: AppLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopNav title={title} subtitle={subtitle} />
      {moduleNav && <ModuleNav items={moduleNav} />}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
