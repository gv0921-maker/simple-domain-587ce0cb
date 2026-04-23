

# Opportunity Detail — Odoo-Style Upgrade Plan

## Summary

Six targeted changes to the existing `OpportunityDetail.tsx` and supporting files, transforming the page to match the Odoo CRM reference layout. No rebuild — surgical edits only.

---

## Change 1 — Won/Lost Ribbon Overlay + "Mark As" Dropdown

**Files:** `src/pages/crm/OpportunityDetail.tsx`

- Remove the standalone Won and Lost buttons (lines 285-311) from the stage bar area
- Add a "Mark As" dropdown button next to the Email button in the top control bar (line 251-253), using `DropdownMenu` from shadcn. Menu items: "Won" and "Lost" (Lost opens the existing dialog)
- On the main content area (`<div className="p-4 max-w-4xl">`, line 282), add `relative overflow-hidden` classes
- Inside that div, conditionally render a CSS ribbon:
  - When `isWon`: green (`bg-green-600`) diagonal ribbon, text "WON", positioned `absolute top-4 -right-7 rotate-45` with wide horizontal padding
  - When `isLost`: grey (`bg-gray-500`) diagonal ribbon, text "LOST"
- The ribbon is purely CSS — no images or SVGs

---

## Change 2 — Time-in-Stage Indicators

**Files:** `src/lib/data/crm.ts`, `src/pages/crm/OpportunityDetail.tsx`

### Data model change
- Add `stageHistory?: { stageId: string; enteredAt: string }[]` to the `Opportunity` interface
- In `updateOpportunityStage()`, append `{ stageId, enteredAt: new Date().toISOString() }` to the opportunity's `stageHistory` array before saving

### UI change
- In the chevron stage bar (lines 316-348), for each stage:
  - Look up the stage in `stageHistory` to find when it was entered
  - If it is the current stage, calculate elapsed time from `enteredAt` to now
  - If it is a past stage, calculate time from its `enteredAt` to the next stage's `enteredAt`
  - Display below the stage name in a `<span>` with format: <1h = "Xm", <24h = "Xh", else "Xd"
  - If no history entry exists for a stage, show no time indicator

---

## Change 3 — Contact Field as Clickable Link

**File:** `src/pages/crm/OpportunityDetail.tsx`

- In the Contact `OdooField` (lines 398-404), when not editing:
  - If `opportunity.contactId` exists, render the contact name as a `<button>` with `text-primary hover:underline` that navigates to `/crm/contacts/${opportunity.contactId}`
  - If no `contactId`, show the name as plain text or "—" if empty

---

## Change 4 — Expected Closing Empty State

**File:** `src/pages/crm/OpportunityDetail.tsx`

- Already implemented at line 431: `'No closing estimate'` is shown when `expectedCloseDate` is falsy
- Verify it renders with `text-muted-foreground` styling. If not, wrap in a `<span className="text-muted-foreground italic">` — currently it falls through to the OdooField's default text color, so add explicit muted styling

---

## Change 5 — Chatter Tab Labels (already mostly done)

**File:** `src/pages/crm/OpportunityDetail.tsx`

- The tabs already say "Send message", "Log note", "Activity" (lines 668-688) — these match the reference
- Move the search icon to the far right of the chatter header (already at line 690) — no change needed
- Ensure active tab has a distinct visual: currently uses variant="default" with colored backgrounds — matches reference style. No changes required here.

---

## Change 6 — Auto-log Stage Changes in Chatter

**File:** `src/pages/crm/OpportunityDetail.tsx`

- In `handleStageClick()` (line 131): after calling `updateOpportunityStage()`, save a system note via `saveNote()`:
  ```
  subject: "Stage changed"
  content: "Stage changed\n{previousStageName} → {newStageName} (Stage)"
  relatedTo: 'opportunity', relatedId: opportunity.id
  userName: user.name, visibility: 'team'
  ```
- In `handleWon()` (line 143): after the stage update, log:
  ```
  content: "Opportunity won\nPending → Won (Won/Lost)\n{previousStageName} → Won (Stage)"
  ```
- In `handleLost()` (line 149): after saving, log:
  ```
  content: "Opportunity lost\nPending → Lost (Won/Lost)\n{previousStageName} → Lost (Stage)"
  ```
- These system notes will appear in the existing chatter timeline automatically since they're saved via `saveNote()`

---

## Technical Details

- **New import:** `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem` from `@/components/ui/dropdown-menu`
- **Opportunity interface change:** Adding optional `stageHistory` array — backward compatible, existing records without it will simply show no time indicators
- **Ribbon CSS:** Uses Tailwind utility classes only (`absolute`, `rotate-45`, overflow-hidden on parent), no custom CSS needed
- **Time formatting helper:** Small inline function `formatElapsed(ms: number)` returning "Xm" / "Xh" / "Xd"
- **No new files created** — all changes are edits to existing files

---

## Execution Order

1. Change 1 (Ribbon + Mark As dropdown) — most visual impact
2. Change 2 (Stage history data model + time indicators)
3. Change 3 (Contact clickable link)
4. Change 4 (Expected Closing empty state styling)
5. Change 5 (Verify chatter tabs — likely no-op)
6. Change 6 (Auto-log stage changes)

Each confirmed individually before proceeding.

