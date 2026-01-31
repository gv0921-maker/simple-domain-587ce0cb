import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
}

interface ModuleNavProps {
  items: NavItem[];
}

export function ModuleNav({ items }: ModuleNavProps) {
  const location = useLocation();

  return (
    <nav className="flex items-center gap-6 border-b border-border bg-card px-4 h-10">
      {items.map((item) => {
        const isActive = location.pathname === item.href;
        return (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              'text-sm font-medium transition-colors duration-150 relative py-2',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {item.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary animate-fade-in" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
