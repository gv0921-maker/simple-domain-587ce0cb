/**
 * Inventory 2 — QC checklist configuration. Pass 11.
 *
 * `inv_test_template` has existed since the Step 4 schema and has never had a
 * UI. Pass 6 found the consequence — a product with no template gets no QC gate
 * at all — and Pass 8 made it visible with a warning on the Quality segment.
 * This is the surface that lets someone act on that warning instead of writing
 * SQL.
 *
 * TWO SCOPES, one table. `product_id` is NULLABLE, and that nullability is the
 * feature:
 *   product_id = <id>   applies to that product only
 *   product_id = NULL   GLOBAL — applies to every product
 * A unit's checklist is the union of both, which is exactly how
 * qc.listTemplatesForProduct and quality.getDocumentQuality already resolve it
 * (`is_active AND (product_id = X OR product_id IS NULL)`). This module does not
 * invent that rule; it configures the rows the rule reads.
 *
 * NO DELETE, even though RLS would allow it for an admin
 * (inv_test_template_delete_admin). A template that has been used is referenced
 * by inv_test_result.template_id with ON DELETE RESTRICT, so deleting one is
 * either refused or — for an unused one — silently erases the fact that a check
 * was ever configured. Archiving via is_active is the supported path and is what
 * the readers already filter on. Rule 4.
 *
 * Rule 5: nothing here catches. RLS refusals and constraint violations surface
 * verbatim.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
type TemplateRow = Tables['inv_test_template']['Row'];

export interface ChecklistTemplate {
  id: string;
  /** NULL = global, applies to every product. */
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  name: string;
  description: string | null;
  is_required: boolean;
  requires_value: boolean;
  requires_attachment: boolean;
  sort_order: number;
  is_active: boolean;
  /** How many results have been recorded against it — archive, never delete. */
  result_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChecklistInput {
  product_id: string | null;
  name: string;
  description: string | null;
  is_required: boolean;
  requires_value: boolean;
  requires_attachment: boolean;
  sort_order: number;
  is_active: boolean;
}

/**
 * All templates, or just the ones applying to one product.
 *
 * When `productId` is given the result is the APPLICABLE set — the product's own
 * templates plus every global one — because that is what an inspector will
 * actually be shown. Listing only the product's own rows would make a product
 * look unconfigured while a global template was silently covering it.
 */
export async function listChecklists(productId?: string): Promise<ChecklistTemplate[]> {
  let query = supabase.from('inv_test_template').select('*');
  if (productId) query = query.or(`product_id.eq.${productId},product_id.is.null`);

  const [tmplRes, prodRes, resultRes] = await Promise.all([
    query.order('sort_order'),
    supabase.from('products').select('id, name, sku'),
    supabase.from('inv_test_result').select('template_id'),
  ]);
  if (tmplRes.error) throw tmplRes.error;
  if (prodRes.error) throw prodRes.error;
  if (resultRes.error) throw resultRes.error;

  const product = new Map((prodRes.data ?? []).map((p) => [p.id, p]));
  const used = new Map<string, number>();
  for (const r of resultRes.data ?? []) {
    used.set(r.template_id, (used.get(r.template_id) ?? 0) + 1);
  }

  return (tmplRes.data ?? []).map((t: TemplateRow) => ({
    id: t.id,
    product_id: t.product_id,
    product_name: t.product_id ? (product.get(t.product_id)?.name ?? null) : null,
    product_sku: t.product_id ? (product.get(t.product_id)?.sku ?? null) : null,
    name: t.name,
    description: t.description,
    is_required: t.is_required,
    requires_value: t.requires_value,
    requires_attachment: t.requires_attachment,
    sort_order: t.sort_order,
    is_active: t.is_active,
    result_count: used.get(t.id) ?? 0,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));
}

/* ------------------------------------------------------------------- write */

export async function createChecklist(input: ChecklistInput): Promise<string> {
  const { data, error } = await supabase
    .from('inv_test_template')
    .insert({
      product_id: input.product_id,
      name: input.name.trim(),
      description: input.description?.trim() ? input.description.trim() : null,
      is_required: input.is_required,
      requires_value: input.requires_value,
      requires_attachment: input.requires_attachment,
      sort_order: input.sort_order,
      is_active: input.is_active,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Update. `product_id` is deliberately NOT patchable: moving a template between
 * a product and global — or between two products — would retroactively change
 * what every recorded inv_test_result was a check OF. The replacement is a new
 * template and archiving the old one.
 */
export async function updateChecklist(
  id: string,
  patch: Partial<Omit<ChecklistInput, 'product_id'>>,
): Promise<void> {
  const row: Tables['inv_test_template']['Update'] = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.description !== undefined) {
    row.description = patch.description?.trim() ? patch.description.trim() : null;
  }
  if (patch.is_required !== undefined) row.is_required = patch.is_required;
  if (patch.requires_value !== undefined) row.requires_value = patch.requires_value;
  if (patch.requires_attachment !== undefined) row.requires_attachment = patch.requires_attachment;
  if (patch.sort_order !== undefined) row.sort_order = patch.sort_order;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase.from('inv_test_template').update(row).eq('id', id);
  if (error) throw error;
}

/** Archive or restore. The only withdrawal path — see the header. */
export async function setChecklistActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('inv_test_template')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw error;
}

/**
 * How many units a REQUIRED check would newly apply to, and how many of those
 * are currently passing.
 *
 * WHY THIS EXISTS. inv_record_qc_results does not evaluate only the results
 * being submitted — it re-derives the unit's status against the ENTIRE
 * applicable checklist every time it runs:
 *
 *     WHEN v_req_failed > 0          THEN 'rejected'
 *     WHEN v_req_passed < v_required THEN 'quarantined'   -- incomplete
 *     WHEN v_adv_failed > 0          THEN 'attention'
 *     ELSE                                'ok'
 *
 * Add a required template and `v_required` goes up for every applicable unit
 * while `v_req_passed` does not, so an already-inspected unit becomes
 * incomplete. It does NOT change immediately — the row is only rewritten the
 * next time QC is recorded for that unit — which is exactly the part that
 * surprises people.
 *
 * ADVISORY CHECKS CARRY NO SUCH RISK, and the same CASE is why: `v_adv_failed`
 * counts `NOT is_required AND l.result IS FALSE`. An unanswered advisory has no
 * latest row at all, so `l.result` is NULL, `NULL IS FALSE` is false, and it
 * contributes nothing. An advisory check can only ever move a unit to
 * 'attention' by being actively failed; it can never un-pass one.
 *
 * `destroyed` and `lost` units are exempt — the RPC returns their status
 * unchanged before the CASE is applied — and they are not counted here because
 * they are not 'ok' either.
 */
export interface RequiredCheckImpact {
  /** Units the check would apply to. */
  applicable: number;
  /** Of those, the ones currently passing — the visible drop. */
  currentlyOk: number;
}

export async function requiredCheckImpact(
  productId: string | null,
): Promise<RequiredCheckImpact> {
  // A global check (product_id NULL) applies to every unit in the system, which
  // is precisely when this warning matters most.
  let query = supabase.from('inv_stock_item').select('status');
  if (productId) query = query.eq('product_id', productId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  return {
    applicable: rows.length,
    currentlyOk: rows.filter((r) => r.status === 'ok').length,
  };
}

/** Products to attach a template to, plus the global option. */
export async function listChecklistProductOptions(): Promise<{ id: string; name: string; sku: string }[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}
