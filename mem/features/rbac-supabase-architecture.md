---
name: RBAC Supabase Architecture
description: RBAC roles/permissions/audit logs live in Supabase tables (app_roles, app_role_permissions, app_user_role_assignments, app_audit_logs). src/lib/data/rbac.ts keeps a sync API backed by an in-memory cache hydrated via bootstrapRbac() on auth state change.
type: feature
---
RBAC data sources:
- `app_roles`, `app_role_permissions`, `app_user_role_assignments`, `app_audit_logs` — new granular RBAC tables (added alongside the existing enum-based `user_roles` table; the enum table still drives RLS policies on CRM/Sales/Inventory/Manufacturing/Invoicing).
- `src/lib/data/rbac.ts` exposes sync APIs (`getRoles`, `getUserRole`, `hasPermission`, `isSuperAdminUser`, `saveRole`, `setUserRoles`, `addAuditLog`, …) backed by an in-memory cache.
- `bootstrapRbac(userId)` is called from `AuthContext` after sign-in to hydrate the cache from Supabase. `hydrateRbacFromSupabase()` re-syncs.
- Async service layer: `src/lib/services/settings/api.ts`. TanStack hooks: `src/hooks/settings/index.ts` (`useRoles`, `useCreateRole`, `useUpdateRole`, `useDeleteRole`, `useUserRoleAssignments`, `useSetUserRoleAssignments`, `useAuditLogs`, `useInsertAuditLog`).
- Default roles are seeded by migration: Super Admin, Admin, Sales Manager, Warehouse Operator, Accountant, HR Manager, POS Operator, Read Only. The oldest auth user is auto-assigned Super Admin and granted the legacy `super_admin` enum so existing RLS policies recognise them.
- Audit log policy: any authenticated user may INSERT; only admins (legacy enum admin/super_admin OR Super Admin/Admin in new tables, resolved via `public.is_app_admin`) may SELECT.