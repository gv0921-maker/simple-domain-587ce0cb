# Fix Customer Unification (Sales ↔ CRM)

## Problem
`quotations.customer_id` and `sales_orders.customer_id` are FKs to `customers`, but `QuotationForm`/`SalesOrderForm` populate `customerId` from `crm_contacts` via `useContacts()`. Every save fails with an FK violation. Saving a customer in `CustomerForm` doesn't show up in CRM, and saving a CRM contact doesn't show up in Sales.

## Part 1 — Forms read from `customers`

**`src/components/sales/CustomerSelector.tsx`**
- Replace `useContacts()` with `useCustomers()` from `@/hooks/sales`.
- Update displayed fields: use `name`, `email`, `phone`, `company` from `SbCustomer`.
- Keep the same onChange contract (emit full row) and `onCreateNew` slot.

**`src/pages/sales/QuotationForm.tsx` and `src/pages/sales/SalesOrderForm.tsx`**
- Replace `useContacts()` import/call with `useCustomers()`.
- When a customer is picked, set `customerId = customer.id` (real `customers.id` UUID) and `customerName = customer.name`.
- Auto-populate billing/contact fields from the `customers` row (email, phone, address, gstin).
- Leave the rest of the form, lines, totals, and save mutations unchanged.
- `onCreateNew` should navigate to `/sales/customers/new` (CustomerForm) instead of CRM ContactForm.

## Part 2 — Two-way CRM ↔ Customers sync (email as match key)

Add a small helper module `src/lib/sales/customerCrmSync.ts` exporting:
- `upsertCustomerFromContact(contact)` — looks up `customers` by lowercase email, updates if found, inserts otherwise. Maps:
  - `name` ← `${firstName} ${lastName}`.trim() (fallback to `companyName`)
  - `email`, `phone`, `company` (from `companyName`), `contactPerson` (full name when company present)
- `upsertContactFromCustomer(customer)` — looks up `crm_contacts` by lowercase email, updates if found, inserts otherwise. Splits `name` into first/last; sets `type='individual'`, copies `email`, `phone`, `companyName` from `company`.
- Both helpers no-op when `email` is empty (can't match safely).

**Wire-up**
- `src/pages/crm/ContactForm.tsx`: after `saveContactMutation.mutateAsync(...)` succeeds, call `upsertCustomerFromContact(saved)` (fire-and-forget with try/catch toast; invalidate `salesKeys.customers()`).
- `src/pages/sales/CustomerForm.tsx`: after `saveMut.mutate` succeeds, call `upsertContactFromCustomer(saved)` (try/catch; invalidate CRM contacts query).
- Also do the same sync from `src/components/crm/CRMFormDialogs.tsx` `ContactFormDialog.handleSubmit` so dialog-created contacts appear in Sales too.

## Verification
- `tsc --noEmit` clean.
- Manual save: create a CRM contact → appears in Sales customer dropdown → create quotation with that customer → save succeeds (no 23503 FK error). Same in reverse from CustomerForm.

## Out of scope
- Backfill of existing `crm_contacts` not yet mirrored to `customers` (one-off; can be a separate task if needed).
- Deduplication beyond email match.
- Changing the FK target of `quotations.customer_id` (keeping `customers` as the system of record for transactions).
