import { supabase } from './client';

/**
 * Deliberately loose Supabase handle for RPCs and tables that are not present
 * in the generated `types.ts`. This centralizes what used to be dozens of
 * scattered `supabase as any` casts behind a single, documented escape hatch —
 * prefer the typed `supabase` client for anything that IS in the generated
 * types, and reach for `db` only for the untyped remainder.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;
