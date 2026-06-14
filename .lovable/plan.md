# CRM Fix Batch 2 — Odoo-style Stackable Filters

Build a reusable, stackable filter framework and wire it into CRM Pipeline + Contacts. Backed by a new `user_saved_filters` Supabase table with per-user and system-wide defaults.

## 1. Database (Supabase migration)

New table `public.user_saved_filters`:
- `id uuid pk`, `user_id uuid → auth.users`, `module text`, `name text`, `filter_state jsonb`, `is_default bool`, `is_system_default bool`, `created_at`, `updated_at`
- Unique `(user_id, module, name)`
- Indexes: `(user_id, module)`, `(module, is_system_default)`
- GRANTs to `authenticated` + `service_role`
- RLS: select own OR `is_system_default=true`; insert/update/delete own only; only `super_admin` may set `is_system_default=true` (enforced via a BEFORE trigger using `has_role`)
- `updated_at` trigger

RPCs (SECURITY DEFINER, search_path=public):
- `set_user_default_filter(p_module text, p_filter_id uuid)` — unsets other defaults for caller+module, sets target true
- `set_system_default_filter(p_module text, p_filter_id uuid)` — super_admin only; same for `is_system_default`

## 2. Filter framework (shared, module-agnostic)

New folder `src/lib/filters/`:
- `types.ts` — `FilterState`, `FilterGroup`, `Operator`, `FieldConfig`, `ModuleFilterConfig`
- `applyFilters.ts` — `buildSupabaseQuery(query, state)` translates operators to PostgREST builder calls; resolves relative dates (`today`, `this_week`, `this_month`, `last_n_days`) at call time
- `clientFilter.ts` — same logic applied to in-memory arrays (used by Pipeline kanban, which already fetches all opportunities)
- `modules/crmOpportunities.ts`, `modules/crmContacts.ts` — field/group-by/sort configs

## 3. Service + hooks

- `src/lib/services/savedFilters.ts` — `getSavedFilters`, `saveFilter`, `updateFilter`, `deleteFilter`, `getDefaultFilter`, `setUserDefault`, `setSystemDefault`
- `src/hooks/useSavedFilters.ts` — TanStack Query hooks (`useSavedFilters(module)`, `useDefaultFilter(module)`, mutations)

## 4. UI components

`src/components/filters/`:
- `FilterBar.tsx` — search input · Filters button (with active count badge) · Group By dropdown · Sort dropdown · Favorites dropdown (load / set default / delete / save as…) · Clear All. Renders chips below for active filter groups (`Field · Operator · Value` with ×). Persists `last_used` to localStorage per module. Keyboard shortcut `F` opens FilterPopover.
- `FilterPopover.tsx` — pick field → operator → value editor. Operators auto-derived from field type (text/numeric/date/choice/multi_choice). Multi-select uses Command list.
- `SaveFilterDialog.tsx` — name + "set as my default" + (super_admin only) "set as default for everyone".
- `FilterEmptyState.tsx` — shown when results empty; Clear All button.

## 5. Wire into CRM

- `CRMPipeline.tsx` + `CRMKanbanBoard.tsx` + `CRMPipelineListView.tsx` — replace `CRMSearchDropdown` usage with `<FilterBar config={crmOpportunitiesFilterConfig} value={state} onChange={...} />`. Apply filters client-side via `clientFilter.ts` on the already-fetched opportunity list (kanban stays grouped by stage; if `group_by` is set in list view, list re-groups; in kanban view, an info chip notes group-by is shown in list view only).
- `CRMContactsList.tsx` — replace search input with `<FilterBar config={crmContactsFilterConfig} ... />`. Sort + group-by handled in-list.
- On mount: load `getDefaultFilter(module)` (user default → system default → empty) AND merge `localStorage.last_used_<module>` if present and no explicit default.

## 6. Cleanup

- Migrate any legacy `crm_saved_searches` localStorage entries to `user_saved_filters` on first authenticated load (best-effort, then drop the localStorage key).
- Delete `src/lib/crm/searchFilters.ts` and remove its imports (`CRMSearchBar.tsx` if no longer used — verify and remove or refactor to FilterBar).
- Keep `CRMSearchDropdown.tsx` only if still referenced; otherwise delete.

## 7. Verification

- `tsc --noEmit` clean.
- Manually: add Stage=New, then Salesperson=me, save as favorite, set as default, refresh → auto-applies. Group By Salesperson re-groups list view. Sort by Expected Revenue desc works.

## Technical notes

- Relative dates resolved in `applyFilters.ts` using `date-fns` (already in deps) to avoid stale ranges.
- Filter chip labels resolved via `fieldConfig.loadOptions` cache so FK ids render as human names.
- `FilterBar` is generic — Batch 3+ modules (Sales Orders, Invoices, etc.) can adopt it by adding a `modules/<x>.ts` config.

After approval I'll create the migration first (so types regenerate), then implement the framework, components, wire CRM pages, and verify.
