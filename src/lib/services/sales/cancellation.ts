import { releaseReservationsForSalesOrderAsync } from '@/lib/services/inventory/reservations';

/**
 * Side effects that must accompany cancelling a sales order.
 *
 * Cancelling used to be a bare `UPDATE sales_orders SET status='cancelled'`.
 * The detail form later grew a reservation release, but the list view's
 * cancel action never did, so serials reserved for an order cancelled from
 * the list stayed pinned to it and could not be sold to anyone else.
 *
 * Everything that has to happen alongside the status write belongs here, so
 * the two entry points cannot drift apart again. Call it *after* the status
 * write has succeeded.
 *
 * Returns the number of reservations released. Throws if the release fails —
 * callers decide how to surface that, since the cancellation itself has
 * already been persisted by then.
 */
export async function applySalesOrderCancellationEffects(
  orderId: string,
): Promise<number> {
  return releaseReservationsForSalesOrderAsync(orderId);
}
