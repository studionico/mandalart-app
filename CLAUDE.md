# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

マンダラート（Mandalart）— a hierarchical 3×3 grid thinking tool. Each cell can be drilled into to reveal another 3×3 grid, enabling infinite-depth expansion. Grids at the same level can also expand in parallel (side-by-side), navigated with ← → buttons.

## Commands

```bash
# Development
npm run dev

# Build
npm run build

# Lint
npm run lint

# Type check
npx tsc --noEmit
```

## Architecture

### Tech Stack

- **Framework**: Next.js 14+ App Router (`src/app/`)
- **Styling**: Tailwind CSS
- **Database / Auth / Realtime**: Supabase (PostgreSQL + Supabase Auth + Supabase Realtime)
- **Storage**: Supabase Storage (bucket: `cell-images`)
- **State**: Zustand (`editorStore`, `undoStore`, `clipboardStore`)
- **Offline**: IndexedDB via `src/lib/offline.ts`
- **Export**: html2canvas + jsPDF
- **Deploy**: Vercel

### Data Model

Three core tables form a recursive hierarchy:

```
mandalarts → grids → cells → grids (child, via parent_cell_id) → cells → …
```

- `grids.parent_cell_id = NULL` → root grid (one per parallel slot)
- `grids.sort_order` → controls ← → parallel navigation order
- `cells.position` 0–8 (4 = center); position 4 is always the theme cell
- `stock_items.snapshot` → JSONB deep-copy of a cell + its entire subtree

### Layered Architecture

UI components never call Supabase directly. The call chain is:

```
components/ → hooks/ → lib/api/ → Supabase SDK
```

This keeps `lib/api/` and `src/types/` reusable for future React Native / Tauri clients.

### Key Source Directories

| Path | Purpose |
|------|---------|
| `src/lib/api/` | One file per entity: `auth`, `mandalarts`, `grids`, `cells`, `stock`, `storage`, `transfer` |
| `src/lib/utils/` | Pure logic: `grid.ts` (grid ops), `dnd.ts` (D&D rules), `import-parser.ts`, `export.ts` |
| `src/lib/realtime.ts` | Supabase Realtime subscriptions for `cells` and `grids` tables |
| `src/lib/offline.ts` | IndexedDB cache + pending-update queue; `syncPendingUpdates()` called on reconnect |
| `src/store/` | Zustand stores: editor UI state, undo stack, clipboard |
| `src/hooks/` | React hooks that wire stores ↔ API layer |
| `src/constants/tabOrder.ts` | Tab key order: `[4,7,6,3,0,1,2,5,8]` (positions, center-first clockwise) |

### App Router Layout

```
src/app/
  (auth)/login, signup       # No auth guard
  (app)/layout.tsx           # Auth check; redirects to /login if unauthenticated
  (app)/dashboard/           # Mandalart list
  (app)/mandalart/[id]/      # Editor
  api/auth/callback/route.ts # OAuth callback
```

Server Components are used only for auth checks and metadata. All editor logic is `'use client'`.

### Business Rules

**Cell interactions**
- Single-click: drill into child grid (falls back to edit if no child grid exists and cell is empty)
- Double-click: open edit modal/bottom sheet
- Root center cell (position 4, no parent): single-click with content → navigate home
- Peripheral cells are disabled when center is empty

**D&D rules (5 cases)**

| Drag source | Drop target | Result |
|-------------|-------------|--------|
| Peripheral | Peripheral | Swap full subtrees (`swapCellSubtree`) |
| Center | Peripheral (has content) | Swap content only (`swapCellContent`) |
| Center | Peripheral (empty) | Copy subtree (`copyCellSubtree`) |
| Peripheral (has content) | Center | Swap content only |
| Peripheral (empty) | Center | No-op |

**Stock rules** (`src/lib/api/stock.ts`)
- Cell → stock (`addToStock`): snapshot includes the full subtree.
  - Peripheral cell: its child grids
  - Center cell: the grid it belongs to (8 peripherals + their descendants) — mirrors the "center cell's subtree = the grid it is the theme of" interpretation used by `copyCellSubtree`
- Stock → cell (`pasteFromStock`): **empty target cells only, no swap semantics**. Applies snapshot content + recursively inserts `GridSnapshot` children. Stock items are not consumed on paste.

**Empty-data rules**
- New mandalart: held as draft in UI; saved to DB only on first confirmed input
- When all cells in a grid become empty → auto-delete that grid (with Undo toast)
- When root grid empties → auto-delete the entire mandalart

**Tab navigation** (desktop only, inside cell-edit modal)
- Order (1-indexed labels): 5 → 8 → 7 → 4 → 1 → 2 → 3 → 6 → 9 → 5 (clockwise from center)
- When center cell is empty, Tab stays on cell 5

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Documentation

Full specs live in `docs/`:
- `requirements.md` — UX rules, validation, navigation, D&D, import/export
- `data-model.md` — SQL DDL, RLS policies, Storage config, Realtime setup
- `api-spec.md` — TypeScript function signatures for all `lib/api/` modules
- `folder-structure.md` — Full directory tree and design rationale
- `tasks.md` — Phased implementation checklist
