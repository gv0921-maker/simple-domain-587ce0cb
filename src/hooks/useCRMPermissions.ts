// CRM Permission Hook - Demo RBAC for CRM module
import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserPermissions, hasPermission, type PermissionLevel, type RecordScope } from '@/lib/data/rbac';

export type CRMAction = 
  | 'view_crm'
  | 'create_contacts'
  | 'edit_contacts'
  | 'delete_contacts'
  | 'create_leads'
  | 'edit_leads'
  | 'delete_leads'
  | 'convert_leads'
  | 'create_opportunities'
  | 'edit_opportunities'
  | 'delete_opportunities'
  | 'modify_pipeline'
  | 'view_analytics'
  | 'export_data'
  | 'import_data';

interface CRMPermissions {
  canViewCRM: boolean;
  canCreateContacts: boolean;
  canEditContacts: boolean;
  canDeleteContacts: boolean;
  canCreateLeads: boolean;
  canEditLeads: boolean;
  canDeleteLeads: boolean;
  canConvertLeads: boolean;
  canCreateOpportunities: boolean;
  canEditOpportunities: boolean;
  canDeleteOpportunities: boolean;
  canModifyPipeline: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
  canImportData: boolean;
  recordScope: RecordScope;
  can: (action: CRMAction) => boolean;
}

export function useCRMPermissions(): CRMPermissions {
  const { user } = useAuth();
  
  const permissions = useMemo(() => {
    if (!user) {
      return {
        canViewCRM: false,
        canCreateContacts: false,
        canEditContacts: false,
        canDeleteContacts: false,
        canCreateLeads: false,
        canEditLeads: false,
        canDeleteLeads: false,
        canConvertLeads: false,
        canCreateOpportunities: false,
        canEditOpportunities: false,
        canDeleteOpportunities: false,
        canModifyPipeline: false,
        canViewAnalytics: false,
        canExportData: false,
        canImportData: false,
        recordScope: 'own' as RecordScope,
        can: () => false,
      };
    }
    
    const userPerms = getUserPermissions(user.id);
    const crmPerm = userPerms.find(p => p.module === 'crm');
    const salesPerm = userPerms.find(p => p.module === 'sales');
    
    // Combine CRM and Sales permissions (they often overlap)
    const effectiveLevel = Math.max(
      getPermissionWeight(crmPerm?.level || 'none'),
      getPermissionWeight(salesPerm?.level || 'none')
    );
    
    const canView = effectiveLevel >= 1;
    const canCreate = effectiveLevel >= 2;
    const canEdit = effectiveLevel >= 3;
    const canDelete = effectiveLevel >= 4;
    const isAdmin = effectiveLevel >= 5;
    
    const recordScope = crmPerm?.scope || salesPerm?.scope || 'own';
    
    const can = (action: CRMAction): boolean => {
      switch (action) {
        case 'view_crm':
          return canView;
        case 'create_contacts':
        case 'create_leads':
        case 'create_opportunities':
          return canCreate;
        case 'edit_contacts':
        case 'edit_leads':
        case 'edit_opportunities':
          return canEdit;
        case 'delete_contacts':
        case 'delete_leads':
        case 'delete_opportunities':
          return canDelete;
        case 'convert_leads':
          return canEdit;
        case 'modify_pipeline':
          return isAdmin;
        case 'view_analytics':
          return canView;
        case 'export_data':
          return canView;
        case 'import_data':
          return canCreate;
        default:
          return false;
      }
    };
    
    return {
      canViewCRM: canView,
      canCreateContacts: canCreate,
      canEditContacts: canEdit,
      canDeleteContacts: canDelete,
      canCreateLeads: canCreate,
      canEditLeads: canEdit,
      canDeleteLeads: canDelete,
      canConvertLeads: canEdit,
      canCreateOpportunities: canCreate,
      canEditOpportunities: canEdit,
      canDeleteOpportunities: canDelete,
      canModifyPipeline: isAdmin,
      canViewAnalytics: canView,
      canExportData: canView,
      canImportData: canCreate,
      recordScope,
      can,
    };
  }, [user]);
  
  return permissions;
}

function getPermissionWeight(level: PermissionLevel): number {
  const weights: Record<PermissionLevel, number> = {
    none: 0,
    view: 1,
    create: 2,
    edit: 3,
    delete: 4,
    admin: 5,
  };
  return weights[level];
}

// Helper to check if user can access a specific record
export function useCanAccessRecord(
  ownerId?: string,
  teamId?: string
): boolean {
  const { user } = useAuth();
  const { recordScope } = useCRMPermissions();
  
  if (!user) return false;
  
  switch (recordScope) {
    case 'all':
      return true;
    case 'department':
      // In a real app, check if user is in the same department/team
      return true;
    case 'own':
      return ownerId === user.id || !ownerId;
    default:
      return false;
  }
}
