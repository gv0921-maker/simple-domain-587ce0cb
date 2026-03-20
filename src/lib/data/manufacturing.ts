// Manufacturing module data layer

export interface BOMLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  uom: string;
}

export interface BillOfMaterials {
  id: string;
  name: string;
  productId: string;
  productName: string;
  quantity: number;
  uom: string;
  lines: BOMLine[];
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
}

export interface WorkOrder {
  id: string;
  name: string;
  productId: string;
  productName: string;
  bomId: string;
  quantity: number;
  status: 'draft' | 'confirmed' | 'in_progress' | 'done' | 'cancelled';
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  workCenterId: string;
  workCenterName: string;
  progress: number;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

export interface WorkCenter {
  id: string;
  name: string;
  code: string;
  capacity: number;
  costPerHour: number;
  isActive: boolean;
  currentLoad: number;
}

export interface ECO {
  id: string;
  name: string;
  productId: string;
  productName: string;
  type: 'bom_change' | 'routing_change' | 'product_update';
  status: 'draft' | 'in_review' | 'approved' | 'applied' | 'rejected';
  requestedBy: string;
  requestedDate: string;
  description: string;
}

// Mock data
let workOrders: WorkOrder[] = [];

let boms: BillOfMaterials[] = [];

let workCenters: WorkCenter[] = [];

let ecos: ECO[] = [];

// CRUD operations
export function getWorkOrders() {
  return [...workOrders];
}

export function getWorkOrder(id: string) {
  return workOrders.find(wo => wo.id === id);
}

export function createWorkOrder(data: Omit<WorkOrder, 'id' | 'name' | 'progress'>) {
  const newId = `WO-${String(workOrders.length + 1).padStart(3, '0')}`;
  const newWO: WorkOrder = {
    ...data,
    id: newId,
    name: `WO/2024/${String(workOrders.length + 1).padStart(3, '0')}`,
    progress: 0,
  };
  workOrders = [...workOrders, newWO];
  return newWO;
}

export function updateWorkOrder(id: string, data: Partial<WorkOrder>) {
  workOrders = workOrders.map(wo => wo.id === id ? { ...wo, ...data } : wo);
  return workOrders.find(wo => wo.id === id);
}

export function deleteWorkOrder(id: string) {
  workOrders = workOrders.filter(wo => wo.id !== id);
}

export function getBOMs() {
  return [...boms];
}

export function getBOM(id: string) {
  return boms.find(b => b.id === id);
}

export function createBOM(data: Omit<BillOfMaterials, 'id' | 'createdAt'>) {
  const newId = `BOM-${String(boms.length + 1).padStart(3, '0')}`;
  const newBOM: BillOfMaterials = {
    ...data,
    id: newId,
    createdAt: new Date().toISOString().split('T')[0],
  };
  boms = [...boms, newBOM];
  return newBOM;
}

export function updateBOM(id: string, data: Partial<BillOfMaterials>) {
  boms = boms.map(b => b.id === id ? { ...b, ...data } : b);
  return boms.find(b => b.id === id);
}

export function deleteBOM(id: string) {
  boms = boms.filter(b => b.id !== id);
}

export function getWorkCenters() {
  return [...workCenters];
}

export function createWorkCenter(data: Omit<WorkCenter, 'id' | 'currentLoad'>) {
  const newId = `WC-${String(workCenters.length + 1).padStart(3, '0')}`;
  const newWC: WorkCenter = { ...data, id: newId, currentLoad: 0 };
  workCenters = [...workCenters, newWC];
  return newWC;
}

export function updateWorkCenter(id: string, data: Partial<WorkCenter>) {
  workCenters = workCenters.map(wc => wc.id === id ? { ...wc, ...data } : wc);
  return workCenters.find(wc => wc.id === id);
}

export function deleteWorkCenter(id: string) {
  workCenters = workCenters.filter(wc => wc.id !== id);
}

export function getECOs() {
  return [...ecos];
}

export function createECO(data: Omit<ECO, 'id' | 'name'>) {
  const newId = `ECO-${String(ecos.length + 1).padStart(3, '0')}`;
  const newECO: ECO = {
    ...data,
    id: newId,
    name: `ECO/2024/${String(ecos.length + 1).padStart(3, '0')} - ${data.description.slice(0, 30)}`,
  };
  ecos = [...ecos, newECO];
  return newECO;
}

export function updateECO(id: string, data: Partial<ECO>) {
  ecos = ecos.map(e => e.id === id ? { ...e, ...data } : e);
  return ecos.find(e => e.id === id);
}
