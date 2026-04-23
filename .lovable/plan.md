

# OpportunityDetail — Inline Editing, Live Chatter, Audit Logging

## Summary

Three sequential changes to `src/pages/crm/OpportunityDetail.tsx`. No new files created. All changes are edits to the existing component.

---

## Bug Fix 1 — Inline Editing Without Edit Button (Odoo Style)

**File:** `src/pages/crm/OpportunityDetail.tsx`

### State changes
- Remove `isEditing` (line 111) and `editData` (line 112) state variables
- Remove `currentData` derived variable (line 266)
- Add new state:
  ```
  const [editingData, setEditingData] = useState<Opportunity>(opportunity)
  const [isDirty, setIsDirty] = useState(false)
  ```
- Add `useEffect` to sync `editingData` when `opportunity` changes and `isDirty` is false
- Add helper:
  ```
  const updateField = (field: keyof Opportunity, value: any) => {
    setEditingData(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
  }
  ```

### Save and Discard handlers
- Replace `handleSave` to: save `editingData` via `saveOpportunity()`, refresh `opportunity`, reset `isDirty`, toast
- Add `handleDiscard` that resets `editingData` to `opportunity` and clears `isDirty`

### Field rendering — replace all `isEditing ? ... : ...` conditionals

Every field becomes an always-visible transparent inline input using this shared CSS pattern:
```
"border-0 border-b border-transparent hover:border-border focus:border-primary 
 bg-transparent w-full text-sm outline-none transition-colors"
```

| Field | Implementation |
|-------|---------------|
| **Opportunity Name** (line 416) | Large transparent `<input>` with `text-2xl font-normal` class. Bound to `editingData.name` |
| **Expected Revenue** (line 432) | Transparent `<input type="number">` with `w-32`. Bound to `editingData.expectedRevenue` |
| **Probability** (line 446) | Transparent `<input type="number">` with `w-20`. Wrapped with "at X %" display text |
| **Contact** (line 460) | **Dual behavior:** Contact name is a clickable `<button>` that navigates to `/crm/contacts/{id}`. A `Pencil` icon appears on hover of the field row. Clicking the pencil opens a `Popover` with a search input + filtered list from `getContacts()`. On select, calls `updateField` for both `contactId` and `contactName`. Import `getContacts` and `Popover/PopoverTrigger/PopoverContent`. Import `Pencil` from lucide-react. |
| **Salesperson** (line 478) | Transparent text input bound to `editingData.assignedTo` |
| **Email** (line 486) | Transparent text input bound to `editingData.email` |
| **Expected Closing** (line 498) | Transparent `<input type="date">` bound to `editingData.expectedCloseDate`. When empty, shows "No closing estimate" in muted italic as placeholder |
| **Phone** (line 519) | Transparent text input bound to `editingData.phone` |
| **Tags** (line 529) | **Chip-style input:** Render `editingData.tags.map(tag => <Badge>tag <X onClick={remove}/></Badge>)` followed by a small transparent `<input>` that adds a new tag on Enter. The entire row area has an `onClick` that focuses the input via a ref. Import `X` from lucide-react. |
| **Internal Notes** (line 556) | Always-editable transparent `<Textarea>` bound to `editingData.internalNotes` |
| **Company Name** (line 581) | Transparent text input bound to `editingData.companyName` |

### Unsaved changes bar
- Remove the Edit/Save bar (lines 710-724) entirely — no Edit button
- Add a sticky bar at the bottom of the form column, visible only when `isDirty`:
  ```
  <div className="sticky bottom-0 bg-amber-50 border-t border-amber-200 px-4 py-2 flex items-center gap-3">
    <span className="text-sm text-amber-700 font-medium">Unsaved changes</span>
    <Button size="sm" onClick={handleSave}>Save</Button>
    <Button size="sm" variant="outline" onClick={handleDiscard}>Discard</Button>
  </div>
  ```
- This bar appears regardless of won/lost status

### All references to `currentData` replaced with `editingData`

---

## Bug Fix 2 — Real-Time Chatter Updates

**File:** `src/pages/crm/OpportunityDetail.tsx`

### Replace static memos with reactive state
- Remove the three `useMemo` calls (line 122-124)
- Add `useCallback` and `useRef` to React imports
- Replace with:
  ```
  const [chatterNotes, setChatterNotes] = useState<Note[]>([])
  const [chatterActivities, setChatterActivities] = useState<Activity[]>([])
  const linkedContact = opportunity?.contactId ? getContact(opportunity.contactId) : undefined

  const refreshChatter = useCallback(() => {
    if (!id) return
    setChatterNotes(getNotes('opportunity', id))
    setChatterActivities(getActivities('opportunity', id))
  }, [id])

  useEffect(() => { refreshChatter() }, [refreshChatter])
  ```
- `linkedContact` remains a simple derived value (used in the Contacts tab at lines 585-636)

### Add refreshChatter() after every write
- `handleStageClick` — after `saveNote()` call
- `handleWon` — after `saveNote()` call
- `handleLost` — after `saveNote()` call
- `handleChatterSubmit` — after `saveNote()` / `saveActivity()` call
- `handleActivitySubmit` — after `saveActivity()` call
- `handleSave` — after `saveOpportunity()` (for audit notes from Change 7)

### Update timeline rendering
- Replace `notes` with `chatterNotes` and `activities` with `chatterActivities` in:
  - The timeline array (line 853): `[...chatterNotes, ...chatterActivities.filter(a => a.completed)]`
  - The empty-state check (line 885): `chatterNotes.length === 0 && chatterActivities.filter(...)`

---

## New Feature — Change 7: Automatic Field Change Audit Logging

**File:** `src/pages/crm/OpportunityDetail.tsx`

### Snapshot ref
- Add `const originalSnapshot = useRef<Partial<Opportunity>>({})`
- Populate on mount and reset after every successful save with the tracked field values

### Tracked fields with labels
```
const FIELD_LABELS: Record<string, string> = {
  name: 'Opportunity Name',
  expectedRevenue: 'Expected Revenue',
  probability: 'Probability',
  expectedCloseDate: 'Expected Closing',
  contactName: 'Contact',
  assignedTo: 'Salesperson',
  companyName: 'Company',
  tags: 'Tags',
}
```

### Diff logic in handleSave (before calling saveOpportunity)
- Compare `editingData[field]` vs `originalSnapshot.current[field]` for each tracked field
- Format rules:
  - Empty/null/undefined displayed as `—`
  - `expectedRevenue` formatted as `₹` + `toLocaleString('en-IN')`
  - `probability` formatted with `%` suffix
  - `tags` compared as sorted comma-joined strings
- If any diffs found, call `saveNote()` with:
  ```
  saveNote({
    content: `<p><strong>Record updated</strong><br/>Expected Revenue: ₹50,000 → ₹75,000<br/>Salesperson: — → Manisha</p>`,
    relatedTo: 'opportunity',
    relatedId: opportunity.id,
    userId: user?.id || '1',
    userName: 'System',
    visibility: 'team',
  } as any)
  ```
  This is the exact same call signature used by the existing stage change notes (lines 158-165), ensuring consistent "S" avatar rendering in the chatter
- Skip if zero fields changed
- After save, reset `originalSnapshot.current` to the newly saved values
- Call `refreshChatter()` so audit note appears immediately

---

## Technical Details

- **New imports:** `useCallback`, `useEffect`, `useRef` added to React import (line 3). `getContacts` added to crm import (line 54). `Popover`, `PopoverTrigger`, `PopoverContent` from UI. `Pencil`, `X` from lucide-react.
- **No new files** — all changes are edits to `OpportunityDetail.tsx` only
- **Backward compatible** — existing opportunities work unchanged
- **TypeScript check** will be run after all three changes to confirm zero errors

## Execution Order

1. Bug Fix 1 (inline editing + contact dropdown + tags chips)
2. Bug Fix 2 (reactive chatter)
3. Change 7 (audit logging)
4. TypeScript compilation check

