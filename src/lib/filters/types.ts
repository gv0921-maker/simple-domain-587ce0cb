// Generic, module-agnostic filter framework types.
// Used by CRM Pipeline, CRM Contacts, and future modules.

export type Operator =
  | 'is' | 'is_not'
  | 'contains' | 'starts_with'
  | 'in' | 'not_in'
  | 'gt' | 'lt' | 'gte' | 'lte' | 'between'
  | 'is_empty' | 'is_not_empty'
  | 'today' | 'this_week' | 'this_month' | 'last_n_days'
  | 'before' | 'after';

export type FieldType = 'text' | 'numeric' | 'date' | 'choice' | 'multi_choice' | 'boolean';

export interface FieldOption { value: string; label: string }

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  options?: FieldOption[];
  loadOptions?: () => Promise<FieldOption[]> | FieldOption[];
}

export interface FilterGroup {
  id: string;
  field: string;
  operator: Operator;
  value?: string | string[] | number | { from: unknown; to: unknown };
}

export interface SortSpec { field: string; direction: 'asc' | 'desc' }

export interface FilterState {
  groups: FilterGroup[];
  sort_by?: SortSpec;
  group_by?: string;
  search?: string;
}

export const EMPTY_FILTER_STATE: FilterState = { groups: [] };

export interface ModuleFilterConfig {
  moduleKey: string;          // e.g. 'crm_opportunities'
  searchPlaceholder?: string;
  fields: FieldConfig[];
  groupByFields?: string[];   // subset of field keys (or virtual keys)
  sortFields?: string[];      // subset of field keys
}
