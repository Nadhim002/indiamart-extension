# Add Title-Keyword Lead Filters (Include / Exclude)

## Context

The IndiaMART extension already filters incoming leads by price, quantity, age, and state. Users want finer control over **which leads get auto-purchased** based on the lead's product title (`ETO_OFR_TITLE`). This adds two **optional** keyword filters, entered as tag/chip inputs:

- **Include keywords** — keep a lead only if its title contains at least one of these.
- **Exclude keywords** — reject a lead if its title contains any of these.

Both persist in localStorage like every other setting, so they survive panel reloads.

### Agreed behavior

- **Include = OR**: title passes if it contains *any* include keyword. Empty list ⇒ no include filtering.
- **Exclude = hard veto**: if title contains *any* exclude keyword, the lead is rejected — even if it also matched an include keyword (exclude is applied after include and wins).
- **Match = case-insensitive substring**. Multi-word tags (e.g. `school bag`) match as a phrase substring.
- **Tag entry**: pressing **Enter** OR clicking a **"+" button** to the right of the input commits the typed text. On commit: trim, drop empties, dedupe case-insensitively. Tags display as typed; matching is case-insensitive. Each tag chip has an "x" to remove it.
- Inputs are **disabled while the timer is running** (same as existing filters).

### How the two interact with existing filters

A lead must pass **all** gates to be purchased: `(price OR quantity)` AND age AND state AND `includeKeywords (OR)` AND `NOT excludeKeywords`.

---

## Files to change

### 1. Shared types — `src/panel/types/index.ts`
- `LeadFilters`: add `includeKeywords: string[] | null;` and `excludeKeywords: string[] | null;`
- `ExtensionSettings`: add `includeKeywords?: string[];` and `excludeKeywords?: string[];`
- `LeadFiltersAtFirstSeen`: add `includeKeywords?: string[];` and `excludeKeywords?: string[];` (so the CSV snapshot stays consistent).

### 2. New reusable component — `src/panel/components/ui/tag-input.tsx`
A small controlled chip input built from the existing `Input` + `Button` + `lucide-react` (use the `Plus` and `X` icons) + `cn`. Props: `{ id, label, value: string[], onChange: (next: string[]) => void, placeholder?, disabled?, hint? }`.
- Internal `useState` for the current text being typed.
- `addTag()`: trim text; if non-empty and not already present (case-insensitive compare against `value`), call `onChange([...value, trimmed])`; clear the text. Used by both Enter (`onKeyDown`, `e.key === 'Enter'` → `preventDefault` + addTag) and the "+" button (`onClick`).
- `removeTag(tag)`: `onChange(value.filter(t => t !== tag))`.
- Render: label, a row with the text `Input` and a `Button variant="outline" size="icon"` "+" on the right, and below it the chips (each a small rounded `span` with the tag text + an `X` button). Respect `disabled` on input, button, and chip-remove.
- Mirror styling of the existing filter fields in `LeadFilters.tsx` (e.g. `space-y-2`, `Label`, chip pill styled like the `bg-primary/10` badge already used).

### 3. Filter UI — `src/panel/components/LeadFilters.tsx`
- Extend `LeadFiltersProps` with `includeKeywords: string[]`, `setIncludeKeywords`, `excludeKeywords: string[]`, `setExcludeKeywords`.
- Render two `TagInput`s inside the existing `AccordionContent`, after the States block: "Title must include (any)" and "Title must not include". Add hints like `No keywords = no filter`.
- Add `includeKeywords.length > 0` and `excludeKeywords.length > 0` to the `filterCount` badge tally.

### 4. Dashboard wiring — `src/panel/pages/DashboardPage.tsx`
- Add `const [includeKeywords, setIncludeKeywords] = useState<string[]>([])` and same for `excludeKeywords`.
- **Load** (the `localStorage.getItem('im-extension-settings')` effect, ~line 82): `if (saved.includeKeywords !== undefined) setIncludeKeywords(saved.includeKeywords)` and the exclude equivalent.
- **Save** (the auto-save effect, ~line 99): add both arrays to the `settings` object and to the effect dependency array.
- **`handleStart`** (~line 145): add to `filters`:
  ```
  includeKeywords: includeKeywords.length ? includeKeywords : null,
  excludeKeywords: excludeKeywords.length ? excludeKeywords : null,
  ```
- Pass the four new props down to `<LeadFilters />`.
- CSV export (`handleExportCSV`): add two columns ("Filter Include Kw", "Filter Exclude Kw") sourced from `l.filtersAtFirstSeen?.includeKeywords?.join(' | ')` / exclude — keep header/row in lockstep.

### 5. Runtime filter — `public/utils-inject.js` `filterLeads()`
After the state check, before `return true`, add:
```js
const title = (lead.ETO_OFR_TITLE || '').toLowerCase();
if (excludeKeywords && excludeKeywords.length > 0) {
  if (excludeKeywords.some((kw) => title.includes(String(kw).toLowerCase()))) return false;
}
if (includeKeywords && includeKeywords.length > 0) {
  if (!includeKeywords.some((kw) => title.includes(String(kw).toLowerCase()))) return false;
}
```
Destructure `includeKeywords, excludeKeywords` from `filters` at the top of the function.

### 6. Rejection reasons + snapshot — `public/service-worker.js`
- `computeRejectionReasons()` (~line 144): mirror the same logic — push `'Title excluded by keyword'` when an exclude keyword matches, and `'Title keyword not matched'` when include keywords are set and none match. Destructure the two new fields.
- Where `filtersAtFirstSeen` is built when persisting leads to IndexedDB, include `includeKeywords` and `excludeKeywords` from `activeFilters` so the snapshot/CSV is complete.

---

## Verification

1. `npm run build` (or the project's typecheck/lint) — confirm no TS errors from the new props/types.
2. Load the unpacked extension, open the panel:
   - In **Lead filters**, add include tags (e.g. `bag`, `backpack`) via Enter and via the "+" button; add an exclude tag (e.g. `plastic`). Confirm: trim works, duplicates are rejected (case-insensitive), chips remove via "x", inputs disable when the timer runs.
   - Reload the panel → confirm tags persist (localStorage `im-extension-settings`).
3. Start the timer on a `seller.indiamart.com` lead page. In the service-worker console, confirm `filterLeads` keeps only titles containing an include keyword and drops any containing an exclude keyword (exclude wins on a title like "Plastic Bag").
4. Export CSV → confirm the new include/exclude columns populate and the "Reason" column shows the new keyword rejection messages for dropped leads.
