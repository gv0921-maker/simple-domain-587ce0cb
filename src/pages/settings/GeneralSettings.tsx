import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Building2, Shield, Users, ShoppingCart, User, Cog,
  ChevronRight,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import {
  SETTINGS_SECTIONS,
  filterSettingsSections,
  type SettingsNavSection,
} from '@/lib/navigation/settings';
import { useRoleCheck } from '@/hooks/auth/useRoleCheck';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2, Shield, Users, ShoppingCart, User, Cog,
};

const ROLE_LABEL: Record<string, string> = {
  any: 'Everyone',
  admin_or_super: 'Admin',
  super_admin: 'Super Admin',
  hr_or_super: 'HR / Super Admin',
};

export default function GeneralSettings() {
  const { isSuperAdmin, isAdminOrSuper, isAdminOrHR, loading } = useRoleCheck();

  const visibleSections: SettingsNavSection[] = useMemo(
    () =>
      filterSettingsSections(SETTINGS_SECTIONS, {
        isSuperAdmin, isAdminOrSuper, isAdminOrHR,
      }),
    [isSuperAdmin, isAdminOrSuper, isAdminOrHR],
  );

  return (
    <AppLayout title="Settings" moduleNav={SETTINGS_SECTIONS}>
      <div className="p-4 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-medium text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure your workspace. Cards and items are hidden when you don't have access.
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : visibleSections.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            You don't have access to any settings.
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleSections.map((s) => {
              const Icon = ICONS[s.icon] ?? Cog;
              return (
                <Card key={s.id} className="p-5 flex flex-col">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-medium">{s.label}</h2>
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                          {ROLE_LABEL[s.minRole] ?? s.minRole}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                    </div>
                  </div>
                  <ul className="divide-y divide-border border-t border-border -mx-5 mt-auto">
                    {s.items.map((i) => (
                      <li key={i.href}>
                        <Link
                          to={i.href}
                          className="flex items-center justify-between px-5 py-2.5 hover:bg-accent/50 transition-colors"
                        >
                          <span className="text-sm">{i.label}</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}