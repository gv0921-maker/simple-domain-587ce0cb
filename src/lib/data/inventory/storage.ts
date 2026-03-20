// Inventory module storage and CRUD operations

import { getItem, setItem } from '../../storage';
import {
  Product, ProductVariant, Lot, SerialNumber, Warehouse, Location,
  StockMove, StockMoveLine, InventoryTransfer, InventoryAdjustment,
  ReorderRule, ValuationLayer, BarcodeOperation, InventoryRolePermissions,
  DEFAULT_INVENTORY_ROLES, StockMoveState, Activity
} from './types';

// ========== DEFAULT DATA ==========
const DEFAULT_PRODUCTS: Product[] = [];

const DEFAULT_WAREHOUSES: Warehouse[] = [];

const DEFAULT_LOCATIONS: Location[] = [];

const DEFAULT_LOTS: Lot[] = [];

const DEFAULT_SERIALS: SerialNumber[] = [];

const DEFAULT_STOCK_MOVES: StockMove[] = [];

const DEFAULT_TRANSFERS: InventoryTransfer[] = [];

const DEFAULT_ADJUSTMENTS: InventoryAdjustment[] = [];

const DEFAULT_REORDER_RULES: ReorderRule[] = [];

// ========== PRODUCTS CRUD ==========
export function getProducts(): Product[] {
  return getItem<Product[]>('inventory_products', DEFAULT_PRODUCTS);
}

export function getProduct(id: string): Product | undefined {
  return getProducts().find((p) => p.id === id);
}

export function getProductByBarcode(barcode: string): Product | undefined {
  return getProducts().find((p) => p.barcode === barcode || p.barcodes?.includes(barcode));
}

export function saveProduct(product: Product): void {
  const products = getProducts();
  const index = products.findIndex((p) => p.id === product.id);
  if (index >= 0) {
    products[index] = { ...product, updatedAt: new Date().toISOString() };
  } else {
    products.push({ ...product, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('inventory_products', products);
}

export function deleteProduct(id: string): void {
  const products = getProducts().filter((p) => p.id !== id);
  setItem('inventory_products', products);
}

export function updateProductStock(productId: string, quantityChange: number): void {
  const products = getProducts();
  const product = products.find(p => p.id === productId);
  if (product) {
    product.stockOnHand += quantityChange;
    product.updatedAt = new Date().toISOString();
    setItem('inventory_products', products);
  }
}

// ========== WAREHOUSES CRUD ==========
export function getWarehouses(): Warehouse[] {
  return getItem<Warehouse[]>('inventory_warehouses', DEFAULT_WAREHOUSES);
}

export function getWarehouse(id: string): Warehouse | undefined {
  return getWarehouses().find((w) => w.id === id);
}

export function saveWarehouse(warehouse: Warehouse): void {
  const warehouses = getWarehouses();
  const index = warehouses.findIndex((w) => w.id === warehouse.id);
  if (index >= 0) {
    warehouses[index] = warehouse;
  } else {
    warehouses.push({ ...warehouse, id: crypto.randomUUID() });
  }
  setItem('inventory_warehouses', warehouses);
}

export function deleteWarehouse(id: string): void {
  const warehouses = getWarehouses().filter((w) => w.id !== id);
  setItem('inventory_warehouses', warehouses);
}

// ========== LOCATIONS CRUD ==========
export function getLocations(): Location[] {
  return getItem<Location[]>('inventory_locations', DEFAULT_LOCATIONS);
}

export function getLocation(id: string): Location | undefined {
  return getLocations().find((l) => l.id === id);
}

export function getLocationByBarcode(barcode: string): Location | undefined {
  return getLocations().find((l) => l.barcode === barcode);
}

export function getLocationsByWarehouse(warehouseId: string): Location[] {
  return getLocations().filter((l) => l.warehouseId === warehouseId);
}

export function saveLocation(location: Location): void {
  const locations = getLocations();
  const index = locations.findIndex((l) => l.id === location.id);
  if (index >= 0) {
    locations[index] = location;
  } else {
    locations.push({ ...location, id: crypto.randomUUID() });
  }
  setItem('inventory_locations', locations);
}

export function deleteLocation(id: string): void {
  const locations = getLocations().filter((l) => l.id !== id);
  setItem('inventory_locations', locations);
}

// ========== LOTS CRUD ==========
export function getLots(): Lot[] {
  return getItem<Lot[]>('inventory_lots', DEFAULT_LOTS);
}

export function getLot(id: string): Lot | undefined {
  return getLots().find((l) => l.id === id);
}

export function getLotsByProduct(productId: string): Lot[] {
  return getLots().filter((l) => l.productId === productId);
}

export function saveLot(lot: Lot): void {
  const lots = getLots();
  const index = lots.findIndex((l) => l.id === lot.id);
  if (index >= 0) {
    lots[index] = { ...lot, updatedAt: new Date().toISOString() };
  } else {
    lots.push({ ...lot, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('inventory_lots', lots);
}

export function deleteLot(id: string): void {
  const lots = getLots().filter((l) => l.id !== id);
  setItem('inventory_lots', lots);
}

// ========== SERIAL NUMBERS CRUD ==========
export function getSerialNumbers(): SerialNumber[] {
  return getItem<SerialNumber[]>('inventory_serials', DEFAULT_SERIALS);
}

export function getSerialNumber(id: string): SerialNumber | undefined {
  return getSerialNumbers().find((s) => s.id === id);
}

export function getSerialsByProduct(productId: string): SerialNumber[] {
  return getSerialNumbers().filter((s) => s.productId === productId);
}

export function getAvailableSerials(productId: string): SerialNumber[] {
  return getSerialNumbers().filter((s) => s.productId === productId && s.status === 'available');
}

export function saveSerialNumber(serial: SerialNumber): void {
  const serials = getSerialNumbers();
  const index = serials.findIndex((s) => s.id === serial.id);
  if (index >= 0) {
    serials[index] = serial;
  } else {
    serials.push({ ...serial, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  }
  setItem('inventory_serials', serials);
}

export function updateSerialStatus(serialId: string, status: SerialNumber['status'], locationId?: string): void {
  const serials = getSerialNumbers();
  const serial = serials.find(s => s.id === serialId);
  if (serial) {
    serial.status = status;
    if (locationId) serial.locationId = locationId;
    setItem('inventory_serials', serials);
  }
}

// ========== STOCK MOVES CRUD ==========
export function getStockMoves(): StockMove[] {
  return getItem<StockMove[]>('inventory_stock_moves', DEFAULT_STOCK_MOVES);
}

export function getStockMove(id: string): StockMove | undefined {
  return getStockMoves().find((m) => m.id === id);
}

export function getStockMovesByState(state: StockMoveState): StockMove[] {
  return getStockMoves().filter((m) => m.state === state);
}

export function saveStockMove(move: StockMove): void {
  const moves = getStockMoves();
  const index = moves.findIndex((m) => m.id === move.id);
  if (index >= 0) {
    moves[index] = { ...move, updatedAt: new Date().toISOString() };
  } else {
    moves.push({ ...move, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('inventory_stock_moves', moves);
}

export function deleteStockMove(id: string): void {
  const moves = getStockMoves().filter((m) => m.id !== id);
  setItem('inventory_stock_moves', moves);
}

export function validateStockMove(moveId: string, userId: string, userName: string): void {
  const moves = getStockMoves();
  const move = moves.find(m => m.id === moveId);
  if (move && (move.state === 'confirmed' || move.state === 'assigned')) {
    // Update stock levels for each line
    move.lines.forEach(line => {
      updateProductStock(line.productId, move.operationType === 'receipt' ? line.doneQty : -line.doneQty);
    });
    move.state = 'done';
    move.effectiveDate = new Date().toISOString();
    move.updatedAt = new Date().toISOString();
    setItem('inventory_stock_moves', moves);
  }
}

// ========== LEGACY TRANSFERS (backward compat) ==========
export function getTransfers(): InventoryTransfer[] {
  return getItem<InventoryTransfer[]>('transfers', DEFAULT_TRANSFERS);
}

export function getTransfer(id: string): InventoryTransfer | undefined {
  return getTransfers().find((t) => t.id === id);
}

export function saveTransfer(transfer: InventoryTransfer): void {
  const transfers = getTransfers();
  const index = transfers.findIndex((t) => t.id === transfer.id);
  if (index >= 0) {
    transfers[index] = { ...transfer, updatedAt: new Date().toISOString() };
  } else {
    transfers.push({ ...transfer, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('transfers', transfers);
}

export function deleteTransfer(id: string): void {
  const transfers = getTransfers().filter((t) => t.id !== id);
  setItem('transfers', transfers);
}

// ========== ADJUSTMENTS CRUD ==========
export function getAdjustments(): InventoryAdjustment[] {
  return getItem<InventoryAdjustment[]>('inventory_adjustments', DEFAULT_ADJUSTMENTS);
}

export function getAdjustment(id: string): InventoryAdjustment | undefined {
  return getAdjustments().find((a) => a.id === id);
}

export function saveAdjustment(adjustment: InventoryAdjustment): void {
  const adjustments = getAdjustments();
  const index = adjustments.findIndex((a) => a.id === adjustment.id);
  if (index >= 0) {
    adjustments[index] = { ...adjustment, updatedAt: new Date().toISOString() };
  } else {
    adjustments.push({ ...adjustment, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('inventory_adjustments', adjustments);
}

export function approveAdjustment(adjustmentId: string, userId: string): void {
  const adjustments = getAdjustments();
  const adj = adjustments.find(a => a.id === adjustmentId);
  if (adj && adj.status === 'pending_approval') {
    // Apply the adjustments to stock
    adj.lines.forEach(line => {
      updateProductStock(line.productId, line.difference);
    });
    adj.status = 'done';
    adj.approvedBy = userId;
    adj.approvedAt = new Date().toISOString();
    adj.updatedAt = new Date().toISOString();
    setItem('inventory_adjustments', adjustments);
  }
}

// ========== REORDER RULES CRUD ==========
export function getReorderRules(): ReorderRule[] {
  return getItem<ReorderRule[]>('inventory_reorder_rules', DEFAULT_REORDER_RULES);
}

export function getReorderRule(id: string): ReorderRule | undefined {
  return getReorderRules().find((r) => r.id === id);
}

export function saveReorderRule(rule: ReorderRule): void {
  const rules = getReorderRules();
  const index = rules.findIndex((r) => r.id === rule.id);
  if (index >= 0) {
    rules[index] = { ...rule, updatedAt: new Date().toISOString() };
  } else {
    rules.push({ ...rule, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('inventory_reorder_rules', rules);
}

export function deleteReorderRule(id: string): void {
  const rules = getReorderRules().filter((r) => r.id !== id);
  setItem('inventory_reorder_rules', rules);
}

export function checkReorderRules(): ReorderRule[] {
  const rules = getReorderRules().filter(r => r.isActive);
  const products = getProducts();
  const triggered: ReorderRule[] = [];
  
  rules.forEach(rule => {
    const product = products.find(p => p.id === rule.productId);
    if (product && product.stockOnHand <= rule.minQty) {
      triggered.push(rule);
    }
  });
  
  return triggered;
}

// ========== INVENTORY PERMISSIONS ==========
export function getInventoryRolePermissions(): InventoryRolePermissions[] {
  return getItem<InventoryRolePermissions[]>('inventory_role_permissions', DEFAULT_INVENTORY_ROLES);
}

export function getUserInventoryPermissions(userId: string): InventoryRolePermissions | undefined {
  // This would integrate with the main RBAC system
  // For now, return warehouse_operator as default
  return getInventoryRolePermissions().find(r => r.roleId === 'warehouse_operator');
}

export function hasInventoryPermission(userId: string, permission: string): boolean {
  const userPerms = getUserInventoryPermissions(userId);
  return userPerms?.permissions.includes(permission as any) ?? false;
}

// ========== STOCK AVAILABILITY ==========
export function getStockAvailability(productId: string, warehouseId?: string): number {
  const product = getProduct(productId);
  if (!product) return 0;
  
  // For now, return total stock. In full implementation, would filter by warehouse/location
  return product.stockOnHand;
}

export function getForecastedStock(productId: string): { incoming: number; outgoing: number; forecasted: number } {
  const product = getProduct(productId);
  const moves = getStockMoves();
  
  let incoming = 0;
  let outgoing = 0;
  
  moves.forEach(move => {
    if (move.state !== 'done' && move.state !== 'cancelled') {
      move.lines.forEach(line => {
        if (line.productId === productId) {
          if (move.operationType === 'receipt') {
            incoming += line.demandQty - line.doneQty;
          } else if (move.operationType === 'delivery') {
            outgoing += line.demandQty - line.doneQty;
          }
        }
      });
    }
  });
  
  return {
    incoming,
    outgoing,
    forecasted: (product?.stockOnHand ?? 0) + incoming - outgoing
  };
}

// ========== STOCK RESERVATIONS ==========
export function reserveStock(productId: string, quantity: number, sourceDocument: string): boolean {
  const available = getStockAvailability(productId);
  if (available >= quantity) {
    // In full implementation, would create reservation records
    return true;
  }
  return false;
}

export function releaseReservation(productId: string, quantity: number, sourceDocument: string): void {
  // In full implementation, would remove reservation records
}

// ========== VALUATION ==========
export function getStockValuation(): { totalValue: number; byCategory: Record<string, number> } {
  const products = getProducts().filter(p => p.type === 'stockable' && p.trackInventory);
  let totalValue = 0;
  const byCategory: Record<string, number> = {};
  
  products.forEach(product => {
    const value = product.stockOnHand * product.costPrice;
    totalValue += value;
    byCategory[product.category] = (byCategory[product.category] || 0) + value;
  });
  
  return { totalValue, byCategory };
}

// ========== BARCODE OPERATIONS ==========
export function getBarcodeOperations(): BarcodeOperation[] {
  return getItem<BarcodeOperation[]>('inventory_barcode_operations', []);
}

export function saveBarcodeOperation(operation: BarcodeOperation): void {
  const operations = getBarcodeOperations();
  const index = operations.findIndex((o) => o.id === operation.id);
  if (index >= 0) {
    operations[index] = operation;
  } else {
    operations.push({ ...operation, id: crypto.randomUUID() });
  }
  setItem('inventory_barcode_operations', operations);
}

// ========== TRACEABILITY ==========
export function getForwardTraceability(serialOrLotId: string): StockMove[] {
  const moves = getStockMoves().filter(m => m.state === 'done');
  return moves.filter(move => 
    move.lines.some(line => 
      line.lotId === serialOrLotId || line.serialNumbers?.includes(serialOrLotId)
    )
  ).sort((a, b) => new Date(a.effectiveDate || a.createdAt).getTime() - new Date(b.effectiveDate || b.createdAt).getTime());
}

export function getBackwardTraceability(serialOrLotId: string): StockMove[] {
  return getForwardTraceability(serialOrLotId).reverse();
}
