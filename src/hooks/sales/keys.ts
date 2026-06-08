export const salesKeys = {
  all: ['sales'] as const,
  customers: () => [...salesKeys.all, 'customers'] as const,
  customer: (id: string) => [...salesKeys.all, 'customer', id] as const,
  quotations: () => [...salesKeys.all, 'quotations'] as const,
  quotation: (id: string) => [...salesKeys.all, 'quotation', id] as const,
  orders: () => [...salesKeys.all, 'orders'] as const,
  order: (id: string) => [...salesKeys.all, 'order', id] as const,
  pricelists: () => [...salesKeys.all, 'pricelists'] as const,
  pricelist: (id: string) => [...salesKeys.all, 'pricelist', id] as const,
  subscriptions: () => [...salesKeys.all, 'subscriptions'] as const,
  subscription: (id: string) => [...salesKeys.all, 'subscription', id] as const,
};