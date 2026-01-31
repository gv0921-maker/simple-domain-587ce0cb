import { AppLayout } from '@/components/layout/AppLayout';
import { ModuleCard } from '@/components/modules/ModuleCard';
import {
  MessageSquare,
  LayoutDashboard,
  Package,
  Factory,
  Smartphone,
  Barcode,
  Layers,
  Users,
  Grid3X3,
  Settings,
  ShoppingCart,
  FileText,
  DollarSign,
  Wrench,
  CalendarDays,
  HelpCircle,
  Mail,
  Globe,
} from 'lucide-react';

const MODULES = [
  { name: 'Discuss', icon: MessageSquare, href: '/discuss', iconBg: '#fff5eb', iconColor: '#f97316' },
  { name: 'Dashboards', icon: LayoutDashboard, href: '/dashboards', iconBg: '#f0fdf4', iconColor: '#22c55e' },
  { name: 'Inventory', icon: Package, href: '/inventory', iconBg: '#fef3c7', iconColor: '#f59e0b' },
  { name: 'Manufacturing', icon: Factory, href: '/manufacturing', iconBg: '#fae8ff', iconColor: '#a855f7' },
  { name: 'Shop Floor', icon: Smartphone, href: '/shop-floor', iconBg: '#e0f2fe', iconColor: '#0ea5e9' },
  { name: 'Barcode', icon: Barcode, href: '/barcode', iconBg: '#fce7f3', iconColor: '#ec4899' },
  { name: 'PLM', icon: Layers, href: '/plm', iconBg: '#dbeafe', iconColor: '#3b82f6' },
  { name: 'Employees', icon: Users, href: '/employees', iconBg: '#fef9c3', iconColor: '#eab308' },
  { name: 'Apps', icon: Grid3X3, href: '/apps', iconBg: '#ecfeff', iconColor: '#06b6d4' },
  { name: 'Settings', icon: Settings, href: '/settings', iconBg: '#fff7ed', iconColor: '#ea580c' },
];

const MORE_MODULES = [
  { name: 'Sales', icon: ShoppingCart, href: '/sales', iconBg: '#dcfce7', iconColor: '#16a34a' },
  { name: 'Invoicing', icon: FileText, href: '/invoicing', iconBg: '#e0e7ff', iconColor: '#6366f1' },
  { name: 'Accounting', icon: DollarSign, href: '/accounting', iconBg: '#fef3c7', iconColor: '#d97706' },
  { name: 'Maintenance', icon: Wrench, href: '/maintenance', iconBg: '#fee2e2', iconColor: '#dc2626' },
  { name: 'Calendar', icon: CalendarDays, href: '/calendar', iconBg: '#f3e8ff', iconColor: '#9333ea' },
  { name: 'Helpdesk', icon: HelpCircle, href: '/helpdesk', iconBg: '#cffafe', iconColor: '#0891b2' },
  { name: 'Email Marketing', icon: Mail, href: '/email-marketing', iconBg: '#fce7f3', iconColor: '#db2777' },
  { name: 'Website', icon: Globe, href: '/website', iconBg: '#dbeafe', iconColor: '#2563eb' },
];

export default function HomePage() {
  return (
    <AppLayout>
      <div className="min-h-full bg-gradient-lavender p-8">
        <div className="max-w-6xl mx-auto">
          {/* Main modules grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 animate-fade-in">
            {MODULES.map((module, index) => (
              <div
                key={module.name}
                className="animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <ModuleCard {...module} />
              </div>
            ))}
          </div>

          {/* More modules */}
          <div className="mt-12">
            <h2 className="text-lg font-medium text-foreground mb-4">More Apps</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {MORE_MODULES.map((module, index) => (
                <div
                  key={module.name}
                  className="animate-slide-up"
                  style={{ animationDelay: `${(MODULES.length + index) * 50}ms` }}
                >
                  <ModuleCard {...module} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
