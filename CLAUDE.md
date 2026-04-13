# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

マンダラート（Mandalart）— a hierarchical 3×3 grid thinking tool. Each cell can be drilled into to reveal another 3×3 grid, enabling infinite-depth expansion. Grids at the same level can also expand in parallel (side-by-side), navigated with ← → buttons.

**The active codebase is the Tauri desktop app under `desktop/`.** The root-level Next.js project (`src/`, `next.config.ts`, `supabase/`) is the legacy web prototype — kept for reference but no longer maintained. When making changes, work inside `desktop/` unless the user explicitly asks about the web version.

## Commands

All commands run from `desktop/`.

```bash
# Vite dev server only (no Tauri window — fast UI iteration in browser)
npm run dev

# Full Tauri dev (launches native window; required for SQLite / FS plugins)
npm run tauri dev

# Type check
npx tsc --noEmit

# Production build (frontend)
npm run build

# Native app bundles (.dmg / .msi / etc.)
npm run tauri build
```

There is no separate lint script — rely on `tsc --noEmit` for static checks.

## Architecture

### Tech Stack

- **Shell**: Tauri v2 (Rust backend in `src-tauri/`)
- **Frontend**: Vite + React 19 + TypeScript
- **Routing**: React Router v7 (HashRouter — required because Tauri serves a file URL)
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite`)
- **State**: Zustand (`editorStore`, `undoStore`, `clipboardStore`)
- **Database**: SQLite via `tauri-plugin-sql` (local-first, no server required)
- **Export**: html2canvas + jsPDF
- **Path alias**: `@/` → `desktop/src/` (defined in `vite.config.ts` + `tsconfig.json`)

Supabase / cloud sync / auth are **stubbed** (`lib/api/auth.ts`, `lib/realtime.ts`, `lib/offline.ts`) — the app currently runs in local-only mode. Real sync is a future phase.

### Data Model

Three core tables form a recursive hierarchy. Schema lives in `desktop/src-tauri/migrations/001_initial.sql`, auto-applied by `lib.rs` on app start.

```
mandalarts → grids → cells → grids (child, via parent_cell_id) → cells → …
```

- `grids.parent_cell_id = NULL` → root grid (one per parallel slot)
- `grids.sort_order` → controls ← → parallel navigation order
- `cells.position` 0–8 (4 = center); position 4 is always the theme cell
- `stock_items.snapshot` → JSON deep-copy of a cell + its entire subtree

### Layered Architecture

UI components never touch SQLite directly. The call chain is:

```
components/ → hooks/ → lib/api/ → lib/db/ → tauri-plugin-sql
```

`lib/db/index.ts` wraps `tauri-plugin-sql` with `query`, `execute`, `generateId`, `now` helpers. Every `lib/api/*` module uses those; business rules live in `lib/utils/`.

### Key Source Directories (under `desktop/src/`)

| Path | Purpose |
|------|---------|
| `lib/db/` | tauri-plugin-sql wrapper (`query` / `execute` / `generateId` / `now`) |
| `lib/api/` | One file per entity: `auth`, `mandalarts`, `grids`, `cells`, `stock`, `storage`, `transfer` |
| `lib/utils/` | Pure logic: `grid.ts`, `dnd.ts`, `export.ts` (canonical location — prefer these over any duplicates at `lib/*.ts`) |
| `lib/import-parser.ts` | Indented-text / Markdown → `GridSnapshot` parser |
| `lib/realtime.ts`, `lib/offline.ts` | Stubs for future cloud sync |
| `store/` | Zustand stores: `editorStore`, `undoStore`, `clipboardStore` |
| `hooks/` | `useGrid`, `useSubGrids`, `useDragAndDrop`, `useUndo`, etc. |
| `pages/` | `DashboardPage.tsx`, `EditorPage.tsx` (React Router route components) |
| `components/editor/` | `EditorLayout`, `GridView3x3`, `GridView9x9`, `Cell`, `CellEditModal`, `Breadcrumb`, `ParallelNav`, `SidePanel`, `MemoTab`, `StockTab` |
| `constants/tabOrder.ts` | Tab order: `[4, 7, 6, 3, 0, 1, 2, 5, 8]` (0-indexed positions, clockwise from center) |
| `src-tauri/migrations/` | SQL migrations applied on startup |
| `src-tauri/capabilities/default.json` | Tauri v2 permissions (must include `sql:default`, `sql:allow-execute`) |

### Routing

React Router v7 HashRouter in `App.tsx`:

```
/                     → redirect to /dashboard
/dashboard            → DashboardPage (mandalart list)
/mandalart/:id        → EditorPage → EditorLayout
```

There is no auth guard — the app is fully usable offline without login.

### Drag & Drop

**HTML5 DnD does not work reliably in Tauri's WebKit** — drop events are dropped silently. All D&D is implemented via `mousedown` / `mousemove` / `mouseup` + `document.elementFromPoint` in `hooks/useDragAndDrop.ts`. Drop targets are identified by `data-cell-id` and `data-stock-drop` attributes. Do not add HTML5 `draggable` / `onDragStart` handlers to new D&D code.

### Business Rules

**Cell interactions**
- Empty cell: single-click starts inline edit immediately (double-click is a no-op)
- Filled cell: single-click drills (root center → home, sub-grid center → parent, peripheral → child grid), double-click starts inline edit
- `⋯` hover button on any cell opens the full CellEditModal (colors, image, long text)
- Peripheral cells are disabled while the center cell is empty
- The click threshold uses a 220ms timer to distinguish single vs double, so drill has a ~220ms latency on filled cells (the latency vanishes for empty cells)

**D&D rules (5 cases, same-grid and 9×9 cross-subgrid)**

| Drag source | Drop target | Result |
|-------------|-------------|--------|
| Peripheral | Peripheral | Swap full subtrees (`swapCellSubtree`) |
| Center | Peripheral (has content) | Swap content only (`swapCellContent`) |
| Center | Peripheral (empty) | Copy subtree (`copyCellSubtree`) |
| Peripheral (has content) | Center | Swap content only |
| Peripheral (empty) | Center | No-op |

In 9×9 view, the flattened cell list (root + sub-grid cells) is passed to `useDragAndDrop` so drops across sub-grids resolve against the same rule table.

**Stock rules** (`lib/api/stock.ts`)
- Cell → stock (`addToStock`): snapshot includes the full subtree.
  - Peripheral cell: its child grids
  - Center cell: the grid it belongs to (8 peripherals + their descendants) — mirrors the "center cell's subtree = the grid it is the theme of" interpretation used by `copyCellSubtree`
- Stock → cell (`pasteFromStock`): **empty target cells only, no swap semantics**. Applies snapshot content + recursively inserts `GridSnapshot` children. Stock items are not consumed on paste.

**Clipboard (cut / copy / paste)**
- `clipboardStore` holds only `{ mode, sourceCellId }` — no serialized snapshot. Paste operates on the live source cell via `pasteCell`.
- ⌘X / ⌘C / ⌘V work on the **currently hovered cell** (tracked via `document.elementFromPoint` on the last mouse position). Shortcuts are suppressed when focus is inside `INPUT` / `TEXTAREA`.
- Cut + paste → `copyCellSubtree` then clear source content and delete source's child grids.

**Empty-data rules**
- New mandalart: held as draft in UI; saved to DB only on first confirmed input
- When all cells in a grid become empty → auto-delete that grid (with Undo toast)
- When root grid empties → auto-delete the entire mandalart
- When navigating home from an empty mandalart → skip the title dialog and delete silently

**Cell numbering (0-indexed, matches DB `cells.position`)**

```
0 | 1 | 2
--+---+--
3 | 4 | 5    ← 4 = center
--+---+--
6 | 7 | 8
```

**Tab navigation** (inside cells, both inline edit and modal)
- Order: 4 → 7 → 6 → 3 → 0 → 1 → 2 → 5 → 8 → 4 (clockwise from center, ends at position 4 again)
- Shift+Tab is the reverse order
- When center cell (4) is empty, Tab is a no-op (stays on 4); peripherals are disabled until center has content
- IME composition (`e.nativeEvent.isComposing`) suppresses Tab navigation
- Import also places children into peripherals using this same order so the newly imported mandalart's Tab-walk lands on the items the user typed first

### Tauri-specific Gotchas

- **SQL permissions**: any new SQL command used via `tauri-plugin-sql` must be allowed in `src-tauri/capabilities/default.json` (`sql:default` + `sql:allow-execute` are the baseline).
- **Image handling**: `lib/api/storage.ts` is a stub returning data URLs. Real file persistence via `tauri-plugin-fs` is a future task.
- **Window sizing**: grid area uses a `ResizeObserver` on its container to stay square while maximizing within the viewport. Don't hardcode grid dimensions.

### Documentation

Full desktop-app specs live in `desktop/docs/`:
- `requirements.md` — UX rules, validation, navigation, D&D, stock, clipboard
- `data-model.md` — SQL DDL for SQLite schema
- `api-spec.md` — TypeScript function signatures for all `lib/api/` modules
- `folder-structure.md` — Full directory tree and design rationale
- `tasks.md` — Phased implementation checklist (source of truth for what's done / pending)
