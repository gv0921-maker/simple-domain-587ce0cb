import type { ModuleFilterConfig } from '../types';

export const inventoryProductsFilterConfig: ModuleFilterConfig = {
  moduleKey: 'inventory_products',
  searchPlaceholder: 'Search products…',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'sku', label: 'SKU', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'type', label: 'Type', type: 'choice', options: [
      { value: 'stockable', label: 'Stockable' },
      { value: 'consumable', label: 'Consumable' },
      { value: 'service', label: 'Service' },
    ] },
    { key: 'unitOfMeasure', label: 'Unit', type: 'text' },
    { key: 'costPrice', label: 'Cost', type: 'numeric' },
    { key: 'salePrice', label: 'Sale Price', type: 'numeric' },
    { key: 'stockOnHand', label: 'On Hand', type: 'numeric' },
    { key: 'reorderLevel', label: 'Reorder Level', type: 'numeric' },
    { key: 'trackSerials', label: 'Serial Tracked', type: 'boolean' },
    { key: 'trackLots', label: 'Lot Tracked', type: 'boolean' },
  ],
  groupByFields: ['category', 'type', 'unitOfMeasure'],
  sortFields: ['name', 'sku', 'category', 'costPrice', 'salePrice', 'stockOnHand'],
  predefinedFilters: [
    {
      id: 'type',
      label: 'Type',
      filters: [
        { id: 'stockable', label: 'Stockable',
          group: { id: 'pf_p_stockable', field: 'type', operator: 'is', value: 'stockable' } },
        { id: 'consumable', label: 'Consumable',
          group: { id: 'pf_p_consumable', field: 'type', operator: 'is', value: 'consumable' } },
        { id: 'service', label: 'Service',
          group: { id: 'pf_p_service', field: 'type', operator: 'is', value: 'service' } },
      ],
    },
    {
      id: 'tracking',
      label: 'Tracking',
      filters: [
        { id: 'serials', label: 'Serial Tracked',
          group: { id: 'pf_p_serials', field: 'trackSerials', operator: 'is', value: 'true' } },
        { id: 'lots', label: 'Lot Tracked',
          group: { id: 'pf_p_lots', field: 'trackLots', operator: 'is', value: 'true' } },
      ],
    },
  ],
};
