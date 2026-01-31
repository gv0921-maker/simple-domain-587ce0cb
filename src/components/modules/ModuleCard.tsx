import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface ModuleCardProps {
  name: string;
  icon: LucideIcon;
  href: string;
  iconBg?: string;
  iconColor?: string;
}

export function ModuleCard({ name, icon: Icon, href, iconBg, iconColor }: ModuleCardProps) {
  return (
    <Link to={href}>
      <Card className="p-6 flex flex-col items-center gap-3 card-hover hover:shadow-lg cursor-pointer group">
        <div
          className="w-16 h-16 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-105"
          style={{ backgroundColor: iconBg || 'hsl(var(--secondary))' }}
        >
          <Icon
            className="w-8 h-8 transition-transform duration-200"
            style={{ color: iconColor || 'hsl(var(--foreground))' }}
          />
        </div>
        <span className="text-sm font-medium text-foreground">{name}</span>
      </Card>
    </Link>
  );
}
