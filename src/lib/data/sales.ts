// Sales & CRM data management

import { getItem, setItem } from '../storage';

export type LeadStatus = 'new' | 'qualified' | 'proposition' | 'won' | 'lost';
export type OpportunityStage = 'qualification' | 'needs_analysis' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
export type OrderStatus = 'draft' | 'sent' | 'confirmed' | 'done' | 'cancelled';

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  address?: string;
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone?: string;
  company?: string;
  source: string;
  status: LeadStatus;
  expectedRevenue: number;
  probability: number;
  assignedTo?: string;
  tags: string[];
  notes?: string;
  activities: Activity[];
  createdAt: string;
  updatedAt: string;
}

export interface Opportunity {
  id: string;
  name: string;
  contactId?: string;
  contactName: string;
  company?: string;
  stage: OpportunityStage;
  expectedRevenue: number;
  probability: number;
  expectedCloseDate: string;
  assignedTo?: string;
  products: OpportunityProduct[];
  activities: Activity[];
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityProduct {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface SalesOrder {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  status: OrderStatus;
  orderDate: string;
  deliveryDate?: string;
  lines: OrderLine[];
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface Activity {
  id: string;
  userId: string;
  userName: string;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  subject: string;
  description?: string;
  dueDate?: string;
  completed: boolean;
  timestamp: string;
}

// Default demo data
const DEFAULT_CONTACTS: Contact[] = [
  {
    id: '1',
    name: 'John Smith',
    email: 'john.smith@acme.com',
    phone: '+1 555-0123',
    company: 'Acme Corp',
    jobTitle: 'Procurement Manager',
    tags: ['VIP', 'Furniture'],
    createdAt: '2025-01-10T10:00:00Z',
    updatedAt: '2025-01-20T14:00:00Z',
  },
  {
    id: '2',
    name: 'Sarah Johnson',
    email: 'sarah.j@techstart.io',
    phone: '+1 555-0456',
    company: 'TechStart Inc',
    jobTitle: 'Office Manager',
    tags: ['New Customer'],
    createdAt: '2025-01-15T09:00:00Z',
    updatedAt: '2025-01-22T11:00:00Z',
  },
  {
    id: '3',
    name: 'Michael Chen',
    email: 'mchen@globalretail.com',
    phone: '+1 555-0789',
    company: 'Global Retail',
    jobTitle: 'VP Operations',
    tags: ['Enterprise', 'Priority'],
    createdAt: '2025-01-05T08:00:00Z',
    updatedAt: '2025-01-25T16:00:00Z',
  },
];

const DEFAULT_LEADS: Lead[] = [
  {
    id: '1',
    name: 'Office Furniture Quote',
    contactName: 'Emily Davis',
    email: 'emily@newstartup.com',
    phone: '+1 555-1111',
    company: 'New Startup LLC',
    source: 'Website',
    status: 'qualified',
    expectedRevenue: 25000,
    probability: 60,
    assignedTo: 'Sales Manager',
    tags: ['Hot Lead'],
    activities: [
      { id: 'a1', userId: '1', userName: 'Sales Manager', type: 'call', subject: 'Initial contact', completed: true, timestamp: '2025-01-20T10:00:00Z' },
    ],
    createdAt: '2025-01-18T10:00:00Z',
    updatedAt: '2025-01-22T14:00:00Z',
  },
  {
    id: '2',
    name: 'Retail Store Setup',
    contactName: 'Robert Wilson',
    email: 'rwilson@retailchain.com',
    company: 'Retail Chain Corp',
    source: 'Referral',
    status: 'proposition',
    expectedRevenue: 150000,
    probability: 75,
    tags: ['Enterprise'],
    activities: [],
    createdAt: '2025-01-12T09:00:00Z',
    updatedAt: '2025-01-24T11:00:00Z',
  },
  {
    id: '3',
    name: 'Home Office Collection',
    contactName: 'Lisa Brown',
    email: 'lisa.b@freelance.me',
    source: 'Social Media',
    status: 'new',
    expectedRevenue: 5000,
    probability: 30,
    tags: [],
    activities: [],
    createdAt: '2025-01-25T14:00:00Z',
    updatedAt: '2025-01-25T14:00:00Z',
  },
];

const DEFAULT_OPPORTUNITIES: Opportunity[] = [
  {
    id: '1',
    name: 'Acme Corp - Q1 Furniture Order',
    contactId: '1',
    contactName: 'John Smith',
    company: 'Acme Corp',
    stage: 'proposal',
    expectedRevenue: 45000,
    probability: 70,
    expectedCloseDate: '2025-02-28',
    assignedTo: 'Sales Manager',
    products: [
      { productId: '2', productName: 'Wooden Chair - Oak', quantity: 20, unitPrice: 4999, discount: 10 },
      { productId: '3', productName: 'Office Desk - Modern', quantity: 10, unitPrice: 15999, discount: 15 },
    ],
    activities: [],
    createdAt: '2025-01-08T10:00:00Z',
    updatedAt: '2025-01-26T14:00:00Z',
  },
  {
    id: '2',
    name: 'TechStart Office Redesign',
    contactId: '2',
    contactName: 'Sarah Johnson',
    company: 'TechStart Inc',
    stage: 'needs_analysis',
    expectedRevenue: 28000,
    probability: 50,
    expectedCloseDate: '2025-03-15',
    products: [],
    activities: [],
    createdAt: '2025-01-16T09:00:00Z',
    updatedAt: '2025-01-23T11:00:00Z',
  },
];

const DEFAULT_ORDERS: SalesOrder[] = [
  {
    id: '1',
    reference: 'SO-2025-001',
    customerId: '1',
    customerName: 'John Smith - Acme Corp',
    status: 'confirmed',
    orderDate: '2025-01-20',
    deliveryDate: '2025-02-05',
    lines: [
      { id: 'l1', productId: '2', productName: 'Wooden Chair - Oak', quantity: 10, unitPrice: 4999, discount: 5, total: 47490.5 },
    ],
    subtotal: 47490.5,
    tax: 8548.29,
    total: 56038.79,
    createdBy: 'Sales Manager',
    createdAt: '2025-01-20T10:00:00Z',
    updatedAt: '2025-01-20T10:30:00Z',
  },
];

// CRUD operations
export function getContacts(): Contact[] {
  return getItem<Contact[]>('contacts', DEFAULT_CONTACTS);
}

export function getContact(id: string): Contact | undefined {
  return getContacts().find((c) => c.id === id);
}

export function saveContact(contact: Contact): void {
  const contacts = getContacts();
  const index = contacts.findIndex((c) => c.id === contact.id);
  if (index >= 0) {
    contacts[index] = { ...contact, updatedAt: new Date().toISOString() };
  } else {
    contacts.push({ ...contact, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('contacts', contacts);
}

export function getLeads(): Lead[] {
  return getItem<Lead[]>('leads', DEFAULT_LEADS);
}

export function getLead(id: string): Lead | undefined {
  return getLeads().find((l) => l.id === id);
}

export function saveLead(lead: Lead): void {
  const leads = getLeads();
  const index = leads.findIndex((l) => l.id === lead.id);
  if (index >= 0) {
    leads[index] = { ...lead, updatedAt: new Date().toISOString() };
  } else {
    leads.push({ ...lead, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('leads', leads);
}

export function updateLeadStatus(id: string, status: LeadStatus): void {
  const lead = getLead(id);
  if (lead) {
    lead.status = status;
    saveLead(lead);
  }
}

export function getOpportunities(): Opportunity[] {
  return getItem<Opportunity[]>('opportunities', DEFAULT_OPPORTUNITIES);
}

export function getOpportunity(id: string): Opportunity | undefined {
  return getOpportunities().find((o) => o.id === id);
}

export function saveOpportunity(opp: Opportunity): void {
  const opportunities = getOpportunities();
  const index = opportunities.findIndex((o) => o.id === opp.id);
  if (index >= 0) {
    opportunities[index] = { ...opp, updatedAt: new Date().toISOString() };
  } else {
    opportunities.push({ ...opp, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('opportunities', opportunities);
}

export function getSalesOrders(): SalesOrder[] {
  return getItem<SalesOrder[]>('salesOrders', DEFAULT_ORDERS);
}

export function getSalesOrder(id: string): SalesOrder | undefined {
  return getSalesOrders().find((o) => o.id === id);
}

export function saveSalesOrder(order: SalesOrder): void {
  const orders = getSalesOrders();
  const index = orders.findIndex((o) => o.id === order.id);
  if (index >= 0) {
    orders[index] = { ...order, updatedAt: new Date().toISOString() };
  } else {
    orders.push({ ...order, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  setItem('salesOrders', orders);
}
