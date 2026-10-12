# First-cabin seatmap: investigation record and fix

Recreated 2026-10-12 from the previous session's handoff summary
(`HANDOFF-FIRST-CABIN.md` was left untracked in that session's workspace and
did not survive into this one). The original seatmap files were never
committed to this repository, so the module was rebuilt here from the
handoff's bug description, fix direction, and honesty constraint.

## The bug (as investigated)

1. `seatmap_layouts.js` → `resolveLayout()` consulted
   `TYPE_LAYOUT_VARIANTS` **only** when the ticketed cabin was missing from
   the default two-class layout.
2. Business is always present in the widebody default layouts, so for a
   **First** ticket the missing-cabin branch never fired and the First cabin
   was **silently dropped** — the traveler was shown Business.
3. The same rule was duplicated inside `seatmap.js` →
   `createDemoSeatMap()`, so the drop happened twice over.

## The fix (implemented in this repo)

- `resolveLayout()` now ranks candidates by cabin content first:
  carrier-specific variant → type-level variant → default, picking the first
  that **contains the ticketed cabin**. The variant table is consulted
  whenever the ticketed cabin matters, not only in the missing-cabin branch.
- If no reference layout contains the ticketed cabin, the gap is reported
  (`containsTicketedCabin: false`, `missingCabin`, explicit notice) and the
  closest lower-tier layout is shown — a lower cabin is never presented as
  the ticketed one, and no cabin is invented.
- `createDemoSeatMap()` renders whatever `resolveLayout()` returns and no
  longer re-derives cabin selection, so the rule exists exactly once.

## Honesty constraint

Every layout is tier `TYPE_REFERENCE` ("reference"): a generic
aircraft-type reference, **not verified for this airline**. Every resolution
and every demo map carries that notice verbatim, and demo seat states are
deterministic placeholders, never availability. A future `verified` tier
would require dated, per-airline evidence.

## Tests pinning this

`test/seatmap.test.mjs`:

- First ticket on a Business-in-default type resolves to the three-class
  variant (the regression itself, in both `resolveLayout` and
  `createDemoSeatMap`).
- Carrier-specific variant beats the generic type variant.
- Missing-cabin gap is reported, never substituted or invented.
- Business-as-usual paths (Business/Coach tickets, no-cabin queries).
- Honesty constraint on every resolution (tier + notice wording).
- Unknown type/cabin input fails honestly; alias normalization is stable.

## Data caveat

The layout tables (row ranges, seat letters) are illustrative reference
figures rebuilt for this fix, not recovered from the previous session's
untracked data and not verified against any airline. Treat them as
placeholder structure until per-airline evidence exists.
