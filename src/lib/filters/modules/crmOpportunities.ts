import type { ModuleFilterConfig } from '../types';

export const crmOpportunitiesFilterConfig: ModuleFilterConfig = {
  moduleKey: 'crm_opportunities',
  searchPlaceholder: 'Search pipeline…',
  fields: [
    { key: 'name', label: 'Opportunity Name', type: 'text' },
    { key: 'stage', label: 'Stage', type: 'choice', options: [
      { value: 'new', label: 'New' },
      { value: 'qualified', label: 'Qualified' },
      { value: 'proposition', label: 'Proposition' },
      { value: 'won', label: 'Won' },
      { value: 'lost', label: 'Lost' },
    ] },
    { key: 'assignedTo', label: 'Salesperson', type: 'text' },
    { key: 'salesTeam', label: 'Sales Team', type: 'text' },
    { key: 'expectedRevenue', label: 'Expected Revenue', type: 'numeric' },
    { key: 'expectedCloseDate', label: 'Expected Closing', type: 'date' },
    { key: 'contactName', label: 'Contact', type: 'text' },
    { key: 'companyName', label: 'Company', type: 'text' },
    { key: 'priority', label: 'Priority', type: 'choice', options: [
      { value: '0', label: 'No stars' }, { value: '1', label: '★' },
      { value: '2', label: '★★' }, { value: '3', label: '★★★' },
    ] },
    { key: 'createdAt', label: 'Created Date', type: 'date' },
    { key: 'updatedAt', label: 'Last Activity', type: 'date' },
  ],
  groupByFields: ['stage', 'assignedTo', 'salesTeam', 'priority', 'expected_closing_month'],
  sortFields: ['name', 'expectedRevenue', 'expectedCloseDate', 'createdAt', 'updatedAt'],
};
