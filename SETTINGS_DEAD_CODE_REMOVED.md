# Settings Module — Dead Code Removed

Date: 2026-06-15

## Removed pages

| Page | Reason | Files |
|------|--------|-------|
| CRMDataSchema | Static API-docs page describing the old localStorage CRM shapes. CRM is fully on Supabase now; this page documented endpoints that no longer exist and had no consumers besides the settings nav entry and its own route. | `src/pages/settings/CRMDataSchema.tsx` |

## Route cleanup

- `src/App.tsx` — removed `CRMDataSchema` import and the `/settings/data-schema` route.
- `src/lib/navigation/settings.ts` — removed the "Data Schema" nav entry.

## Replaced (not removed)

- `GeneralSettings.tsx` (the `/settings` landing) — fully rewritten as a categorised hub. The legacy hard-coded "save changes" UI is gone; the CRM↔Customer sync utility is preserved on the new hub.
