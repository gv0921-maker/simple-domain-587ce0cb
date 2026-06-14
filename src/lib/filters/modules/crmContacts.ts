import type { ModuleFilterConfig } from '../types';

export const crmContactsFilterConfig: ModuleFilterConfig = {
  moduleKey: 'crm_contacts',
  searchPlaceholder: 'Search contacts…',
  fields: [
    { key: 'firstName', label: 'First Name', type: 'text' },
    { key: 'lastName', label: 'Last Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'companyName', label: 'Company', type: 'text' },
    { key: 'jobTitle', label: 'Job Title', type: 'text' },
    { key: 'status', label: 'Status', type: 'choice', options: [
      { value: 'active', label: 'Active' },
      { value: 'archived', label: 'Archived' },
    ] },
    { key: 'type', label: 'Type', type: 'choice', options: [
      { value: 'individual', label: 'Individual' },
      { value: 'company', label: 'Company' },
    ] },
    { key: 'score', label: 'Score', type: 'numeric' },
    { key: 'createdAt', label: 'Created Date', type: 'date' },
  ],
  groupByFields: ['status', 'companyName', 'type'],
  sortFields: ['firstName', 'lastName', 'companyName', 'score', 'createdAt'],
};
