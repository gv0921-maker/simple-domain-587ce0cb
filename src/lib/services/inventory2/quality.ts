/**
 * Inventory 2 — the Quality segment's data layer.
 *
 * DOCUMENT-TYPE-AGNOSTIC BY CONSTRUCTION, same discipline as the scan engine.
 * Everything here is keyed on an operation id and walks
 *   inv_operation → inv_move → inv_move_line → inv_stock_item → inv_test_result
 * with inv_test_template for the checklist. All four operation kinds share
 * those tables, so a transfer, delivery or adjustment page gets this segment
 * with no rewrite — it never asks what kind of document it is looking at.
 *
 * WHY THIS DOES NOT REUSE getReceiptDetail
 * getReceiptDetail already fetches units, templates and results, so reusing it
 * would save a round trip. It would also make the Quality segment receipt-
 * shaped, which is the one thing this pass is trying to avoid. The extra read
 * is the price of the segment being inheritable, and it is the same trade made
 * in Pass 7 for the scan engine.
 *
 * WRITES: none. QC is recorded only through inv_record_qc_results, called by
 * QcRunner via the qc.ts service. This module never writes inv_stock_item.status
 * — that value is derived by the database and read back.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import {
  explainVerdict,
  type QcAttachment, type QcResultRow, type QcTemplate, type QcVerdict,
} from './qc';

type Enums = Database['public']['Enums'];
export type InvStockStatus = Enums['inv_stock_status'];
export type InvOperationState = Enums['inv_operation_state'];

/* ------------------------------------------------------------------ types */

/** One unit on the document, with its checklist position worked out. */
export interface QualityUnit {
  stock_item_id: string;
  serial: string;
  status: InvStockStatus;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  location_name: string | null;
  received_at: string | null;
  /** Active templates that apply to THIS unit's product, plus global ones. */
  templates: QcTemplate[];
  /** Every result for the unit, newest-per-template marked `is_latest`. */
  results: QcResultRow[];
  verdict: QcVerdict;
  /** No result has ever been recorded against this unit. */
  untouched: boolean;
  /**
   * The document type requires QC, but this unit's product has no applicable
   * active checklist. Surfaced loudly rather than rendered as an empty pass —
   * this is the Pass 6 no-checklist hole made visible at document level.
   */
  missingChecklist: boolean;
}

export interface QualityCounts {
  units: number;
  /** At least one result recorded. */
  inspected: number;
  /** No result recorded yet. */
  awaiting: number;
  quarantined: number;
  ok: number;
  attention: number;
  /** rejected / damaged / destroyed / lost — anything condemned. */
  rejected: number;
  /** Units whose product has no applicable active checklist. */
  missingChecklist: number;
}

export interface DocumentQuality {
  operation_id: string;
  number: string;
  state: InvOperationState;
  type_name: string;
  /** The Pass 8 flag. UI policy — see documentRequiresQc(). */
  requires_qc: boolean;
  units: QualityUnit[];
  counts: QualityCounts;
}

/* -------------------------------------------------------------- the rule */

/**
 * THE SINGLE POINT OF CHANGE for whether the Quality segment is offered.
 *
 * Today it reads inv_operation_type.requires_qc, added in Step 6 and approved
 * by V on 2026-08-12. The alternative — inferring from "does this product have
 * a checklist" — was rejected because a type that requires QC but has no
 * templates configured yet would then show no segment at all, hiding a
 * misconfiguration instead of reporting it.
 *
 * The flag is UI policy, not a database gate. Nothing in Postgres reads it. The
 * actual QC gate is inv_record_qc_results deriving inv_stock_item.status, and
 * it applies whether or not this returns true.
 */
export function documentRequiresQc(doc: { requires_qc: boolean } | null | undefined): boolean {
  return !!doc?.requires_qc;
}

/* ----------------------------------------------------------------- helpers */

function toAttachments(value: Json): QcAttachment[] {
  return Array.isArray(value) ? (value as QcAttachment[]) : [];
}

const CONDEMNED: InvStockStatus[] = ['rejected', 'damaged', 'destroyed', 'lost'];

/* -------------------------------------------------------------------- read */

export async function getDocumentQuality(operationId: string): Promise<DocumentQuality | null> {
  const { data: op, error: opErr } = await supabase
    .from('inv_operation')
    .select('id, number, state, operation_type_id')
    .eq('id', operationId)
    .maybeSingle();
  if (opErr) throw opErr;
  if (!op) return null;

  const [typeRes, movesRes] = await Promise.all([
    supabase
      .from('inv_operation_type')
      .select('id, name, requires_qc')
      .eq('id', op.operation_type_id)
      .maybeSingle(),
    supabase.from('inv_move').select('id, product_id').eq('operation_id', operationId),
  ]);
  if (typeRes.error) throw typeRes.error;
  if (movesRes.error) throw movesRes.error;

  const type = typeRes.data;
  if (!type) throw new Error(`Operation type ${op.operation_type_id} not found.`);

  const moves = movesRes.data ?? [];
  const moveIds = moves.map((m) => m.id);

  const mlRes = moveIds.length
    ? await supabase.from('inv_move_line').select('move_id, stock_item_id').in('move_id', moveIds)
    : null;
  if (mlRes?.error) throw mlRes.error;
  const stockItemIds = [...new Set((mlRes?.data ?? []).map((l) => l.stock_item_id))];

  const itemsRes = stockItemIds.length
    ? await supabase
        .from('inv_stock_item')
        .select('id, serial, status, product_id, location_id, received_at')
        .in('id', stockItemIds)
    : null;
  if (itemsRes?.error) throw itemsRes.error;
  const items = itemsRes?.data ?? [];

  const productIds = [...new Set(items.map((i) => i.product_id))];
  const locationIds = [...new Set(items.map((i) => i.location_id).filter(Boolean) as string[])];

  const [prodRes, locRes, tmplRes, resRes] = await Promise.all([
    productIds.length
      ? supabase.from('products').select('id, name, sku').in('id', productIds) : null,
    locationIds.length
      ? supabase.from('inv_location').select('id, name').in('id', locationIds) : null,
    // is_active filtered here, matching listTemplatesForProduct. A template the
    // configurator switched off must not appear as an outstanding test.
    productIds.length
      ? supabase.from('inv_test_template').select('*').eq('is_active', true)
          .or(`product_id.in.(${productIds.join(',')}),product_id.is.null`)
          .order('sort_order')
      : null,
    stockItemIds.length
      ? supabase.from('inv_test_result').select('*').in('stock_item_id', stockItemIds).order('seq')
      : null,
  ]);
  if (prodRes?.error) throw prodRes.error;
  if (locRes?.error) throw locRes.error;
  if (tmplRes?.error) throw tmplRes.error;
  if (resRes?.error) throw resRes.error;

  const prod = new Map((prodRes?.data ?? []).map((p) => [p.id, p]));
  const loc = new Map((locRes?.data ?? []).map((l) => [l.id, l.name]));
  const allTemplates = (tmplRes?.data ?? []) as QcTemplate[];
  const templateName = new Map(allTemplates.map((t) => [t.id, t.name]));
  const allResults = resRes?.data ?? [];

  // Group results by unit, then mark the newest per template — the same rule
  // inv_record_qc_results applies when it derives the status.
  const resultsByItem = new Map<string, QcResultRow[]>();
  for (const r of allResults) {
    const list = resultsByItem.get(r.stock_item_id) ?? [];
    list.push({
      id: r.id,
      seq: r.seq,
      stock_item_id: r.stock_item_id,
      template_id: r.template_id,
      template_name: templateName.get(r.template_id) ?? null,
      result: r.result,
      value: r.value,
      notes: r.notes,
      attachments: toAttachments(r.attachments),
      tested_at: r.tested_at,
      tested_by: r.tested_by,
      is_latest: false,
    });
    resultsByItem.set(r.stock_item_id, list);
  }
  for (const list of resultsByItem.values()) {
    const latestSeq = new Map<string, number>();
    for (const r of list) {
      const cur = latestSeq.get(r.template_id);
      if (cur === undefined || r.seq > cur) latestSeq.set(r.template_id, r.seq);
    }
    for (const r of list) r.is_latest = latestSeq.get(r.template_id) === r.seq;
  }

  const units: QualityUnit[] = items
    .map((i) => {
      const templates = allTemplates.filter(
        (t) => t.product_id === null || t.product_id === i.product_id,
      );
      const results = resultsByItem.get(i.id) ?? [];
      return {
        stock_item_id: i.id,
        serial: i.serial,
        status: i.status,
        product_id: i.product_id,
        product_name: prod.get(i.product_id)?.name ?? null,
        product_sku: prod.get(i.product_id)?.sku ?? null,
        location_name: i.location_id ? loc.get(i.location_id) ?? null : null,
        received_at: i.received_at,
        templates,
        results,
        verdict: explainVerdict(i.status, templates, results),
        untouched: results.length === 0,
        missingChecklist: templates.length === 0,
      };
    })
    .sort((a, b) => a.serial.localeCompare(b.serial));

  const counts: QualityCounts = {
    units: units.length,
    inspected: units.filter((u) => !u.untouched).length,
    awaiting: units.filter((u) => u.untouched).length,
    quarantined: units.filter((u) => u.status === 'quarantined').length,
    ok: units.filter((u) => u.status === 'ok').length,
    attention: units.filter((u) => u.status === 'attention').length,
    rejected: units.filter((u) => CONDEMNED.includes(u.status)).length,
    missingChecklist: units.filter((u) => u.missingChecklist).length,
  };

  return {
    operation_id: op.id,
    number: op.number,
    state: op.state,
    type_name: type.name,
    requires_qc: type.requires_qc,
    units,
    counts,
  };
}
