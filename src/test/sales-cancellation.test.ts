import { describe, it, expect, vi, beforeEach } from 'vitest';

const releaseMock = vi.fn();

vi.mock('@/lib/services/inventory/reservations', () => ({
  releaseReservationsForSalesOrderAsync: (...args: unknown[]) => releaseMock(...args),
}));

const { applySalesOrderCancellationEffects } = await import(
  '@/lib/services/sales/cancellation'
);

/**
 * Cancelling a sales order has to return its reserved serials to the pool.
 *
 * The list view used to write status='cancelled' and stop there, so serials
 * stayed pinned to a dead order and could not be sold to anyone else — while
 * the confirm dialog told the user the stock had been released. Only the
 * detail form did the release. Both now route through this function.
 */
describe('applySalesOrderCancellationEffects', () => {
  beforeEach(() => {
    releaseMock.mockReset();
  });

  it('releases the reservations held by the order', async () => {
    releaseMock.mockResolvedValue(3);

    const released = await applySalesOrderCancellationEffects('so-123');

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith('so-123');
    expect(released).toBe(3);
  });

  it('propagates failures rather than swallowing them', async () => {
    // The status write has already been persisted by the time this runs, so a
    // silent failure would leave stock stranded with no signal to the user.
    releaseMock.mockRejectedValue(new Error('release_reservations failed'));

    await expect(applySalesOrderCancellationEffects('so-123')).rejects.toThrow(
      'release_reservations failed',
    );
  });

  it('reports zero when the order held no reservations', async () => {
    releaseMock.mockResolvedValue(0);
    await expect(applySalesOrderCancellationEffects('so-none')).resolves.toBe(0);
  });
});
