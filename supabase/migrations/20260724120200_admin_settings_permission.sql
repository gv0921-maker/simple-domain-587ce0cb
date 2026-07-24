-- Give the Admin role access to the settings module.
--
-- DEFAULT_ROLES in src/lib/data/rbac.ts built Admin as "every module except
-- settings". ProtectedRoute calls canAccessRoute -> hasPermission, so every
-- /settings/* route guarded that way returned false for admins and bounced
-- them to '/'. This contradicted useRoleCheck's own capability map, which
-- already declares canManageSettings: isAdminOrSuper.
--
-- The client-side default is only a fallback: _rolesCache is overwritten from
-- app_roles / app_role_permissions once Supabase hydrates, so deployed
-- environments need this row or they keep the old behaviour.
--
-- This does not widen access to the sensitive settings pages. Company,
-- payroll, numbering, holidays, work schedules, payment accounts and audit
-- logs are guarded by RouteGuard superAdmin / SuperAdminRoute, which check
-- roles directly rather than going through this permission table.

INSERT INTO public.app_role_permissions (role_id, module, level, scope, can_import, can_export)
SELECT r.id, 'settings', 'admin', 'all', true, true
  FROM public.app_roles r
 WHERE r.name = 'Admin'
ON CONFLICT (role_id, module) DO UPDATE
  SET level = 'admin',
      scope = 'all',
      can_import = true,
      can_export = true,
      updated_at = now();
