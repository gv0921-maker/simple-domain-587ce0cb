// CRM Dashboard Page
import { AppLayout } from '@/components/layout/AppLayout';
import { CRMDashboard } from '@/components/crm/CRMDashboard';
import { CRM_NAV } from '@/lib/navigation/crm';

export default function CRMOverview() {
  return (
    <AppLayout title="CRM" moduleNav={CRM_NAV}>
      <CRMDashboard />
    </AppLayout>
  );
}
