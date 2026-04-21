

# Plan: Complete 22 Actionable Sales Module Items

## Revised Assessment

From the original 26, **4 are already done** (CSV export from reports, revenue forecast tab, quotations by status, conversion rate KPI exist in SalesReports.tsx). **4 are architecturally impossible** (REST API, OpenAPI docs, server-side pagination, DB indexes). That leaves **22 actionable items**.

Items removed from scope:
- Export to CSV/Excel — already implemented (handleExport in SalesReports.tsx)
- Revenue forecast — already implemented (Forecasts tab)
- Testing (items 27-30) — deferred to a separate testing pass, not mixed with feature work

That reduces to **18 feature items** plus 4 testing items if desired separately.

---

## Pass 1: Utilities & Audit (no UI dependencies)

### 1. Sales Audit Logger
**Create:** `src/lib/sales/audit.ts` (mirrors `src/lib/crm/audit.ts`)
- `logSales(action, resource, resourceId, details)` wrapper
- Resources: `quotation`, `order`, `subscription`, `pricelist`

### 2. Wire Audit Logs into All Sales CRUD
**Edit:** `src/lib/data/sales/storage.ts`
- Add `logSales()` calls to: `saveQuotation`, `deleteQuotation`, `saveSalesOrder`, `deleteSalesOrder`, `saveSubscription`, `savePricelist`, `deletePricelist`
- Log price changes, discount overrides, status transitions, order confirmations

### 3. Price Immutability After Confirmation
**Edit:** `src/lib/data/sales/storage.ts`
- In `saveSalesOrder`: if existing order is `confirmed` or `locked`, reject line price/discount changes (only allow status transitions and non-financial field edits)

### 4. Auto-Expire Quotations
**Create:** `src/lib/sales/automation.ts`
- `autoExpireQuotations()`: scan all `sent`/`draft` quotations, set `expired` if `validUntil < today`
- Call on SalesOverview and QuotationsList mount

### 5. Auto-Create Order on Acceptance
**Edit:** `src/lib/data/sales/storage.ts` or `QuotationForm.tsx`
- When quotation status changes to `accepted`, automatically call `convertQuotationToOrder()`

---

## Pass 2: Quotation Enhancements

### 6. Quotation PDF Download
**Create:** `src/lib/sales/quotationPdf.ts`
- Generate a quotation PDF using browser-native approach (build HTML string, open in new window for print/save)
- Include: company header, quotation ref, customer, lines table, tax breakdown, totals, T&C
**Edit:** `QuotationForm.tsx` — add "Download PDF" button

### 7. Quotation Versioning UI
**Edit:** `QuotationForm.tsx`
- On "Revise" action: snapshot current quotation into `versions[]`, increment `currentVersion`, reset to draft
- Add a "Version History" collapsible section showing past versions with timestamps
- Allow viewing (read-only) any previous version

### 8. Email Send (Simulated)
**Edit:** `QuotationForm.tsx`
- "Send" action opens a dialog showing recipient, subject (auto-filled from quotation ref), and a preview
- On confirm: marks quotation as `sent`, logs activity with email details (no actual SMTP — localStorage only, same pattern as CRM EmailComposerDialog)

---

## Pass 3: CRM ↔ Sales Integration

### 9. Create Quotation from CRM Opportunity
**Edit:** `src/pages/crm/OpportunityDetail.tsx`
- Add "New Quotation" button that navigates to `/sales/quotations/new?opportunityId=xxx&customerId=xxx`
**Edit:** `QuotationForm.tsx`
- Read `opportunityId` and `customerId` from URL params, pre-fill customer and link to opportunity

### 10. Create Quotation from CRM Contact
**Edit:** `src/pages/crm/CRMContactDetail.tsx`
- Add "New Quotation" action button that navigates to `/sales/quotations/new?customerId=xxx`

### 11. Sales History in CRM Records
**Edit:** `src/pages/crm/OpportunityDetail.tsx`, `CRMContactDetail.tsx`
- Add a "Sales" tab showing linked quotations and orders (query by customerId/opportunityId)
- Display: reference, status, total, date

### 12. Update Opportunity Stage on Quotation Acceptance
**Edit:** `QuotationForm.tsx` (in the accept handler)
- If quotation has `opportunityId`, update that opportunity's stage to `won`

---

## Pass 4: Customer Portal

### 13. Customer Portal Pages
**Create:** `src/pages/sales/CustomerPortal.tsx`, `src/pages/sales/CustomerPortalQuotation.tsx`
**Edit:** `src/App.tsx` (add routes `/portal`, `/portal/quotation/:id`)
- Token-based access: URL contains `?token=xxx`, validated against a generated token stored on the customer record
- Read-only view of quotations and orders for that customer
- Accept/Reject buttons on quotations (updates status)
- Mobile-friendly, minimal chrome layout (no full AppLayout)

---

## Pass 5: Reports & Import/Export

### 14. Sales by Salesperson Report
**Edit:** `SalesReports.tsx`
- Add a "Salesperson" tab with revenue and order count grouped by salesperson

### 15. Report Grouping
**Edit:** `SalesReports.tsx`
- Add group-by dropdown (Customer, Salesperson, Month, Status) to the quotations and orders tables

### 16. Import Quotations & Orders from CSV
**Create:** `src/components/sales/SalesImportExport.tsx`
- Reuse the CRM import pattern (CRMImportExport.tsx)
- Parse CSV → validate → save quotations or orders
- Add import button to QuotationsList and SalesOrdersList

### 17. Export Quotations & Orders (Dedicated)
- Already partially done in SalesReports; extend to list pages
**Edit:** `QuotationsListNew.tsx`, `SalesOrdersListNew.tsx`
- Add "Export CSV" button to list toolbars (export all or filtered records)

---

## Pass 6: UI/UX Polish

### 18. Micro-Animations
**Edit:** `QuotationForm.tsx`, `SalesOrderForm.tsx`, list pages
- Add framer-motion `AnimatePresence` for line add/remove
- Status badge transition animations
- Button hover/confirm feedback animations

### 19. Mobile Quick Quotation
**Edit:** `QuotationForm.tsx` or create `src/pages/sales/QuickQuote.tsx`
- Simplified mobile view: customer select, product select, quantity → create draft quotation
- Accessible from SalesOverview on mobile

### 20. Smooth State Transitions
**Edit:** `QuotationForm.tsx`, `SalesOrderForm.tsx`
- Animate status bar/badge changes using framer-motion `layout` transitions

---

## Execution Order

Build in 6 sequential passes:
1. **Utilities & Audit** (items 1-5) — foundational, no UI
2. **Quotation Enhancements** (items 6-8) — PDF, versioning, email
3. **CRM ↔ Sales Integration** (items 9-12) — cross-module linking
4. **Customer Portal** (item 13) — standalone pages
5. **Reports & Import/Export** (items 14-17) — data features
6. **UI/UX Polish** (items 18-20) — animations, mobile

Estimated: ~6 new files, ~15 edited files.

---

## Items NOT Included (with reasons)

| Item | Reason |
|------|--------|
| REST API, OpenAPI docs | No server/backend — architecturally impossible |
| Server-side pagination | No server |
| DB indexes | No database (localStorage) |
| Unit/integration/perf tests | Separate testing pass — can be planned after features |
| Email via SMTP | No backend; simulated email logging only |

