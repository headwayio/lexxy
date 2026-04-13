# Block Editing: Architecture & Implementation

> Notion-style block selection, movement, drag-and-drop, and formatting for Lexxy.
> Branch: `block-editing-standalone` — 53 files changed, ~11,800 lines added.

## Overview

This branch adds a complete block editing system: multi-block selection with keyboard navigation, drag-and-drop reordering, block-level formatting (turn-into, highlight colors), and Cmd+Shift+Up/Down movement through arbitrarily nested list structures. The system is implemented primarily as an extension (`BlockSelectionExtension`) with supporting changes to core lexxy infrastructure where required.

The design goal is Notion-style block semantics: every visible element (paragraph, heading, list item, table, code block, HR) is an individually selectable, movable block. Selected blocks highlight with a subtle fill, can be dragged as a group, and move through nested list hierarchies one step at a time.

---

## File inventory

### New files (extension layer)

| File | Lines | Purpose |
|------|-------|---------|
| `src/extensions/block_selection_extension.js` | 4,027 | Core extension: selection state, keyboard navigation, block movement, formatting, highlight propagation |
| `src/editor/block_drag_and_drop.js` | 2,242 | Drag handles, drop indicators, drag ghosts, auto-scroll, hover detection |
| `src/elements/block_actions_menu.js` | 596 | Floating context menu: turn-into, highlight colors, delete |
| `src/editor/block_helpers.js` | 26 | Shared constants (`BLOCK_SELECTED_CLASS`, etc.) and `$isStructuralWrapper()` helper |
| `src/nodes/wrapped_table_node.js` | 74 | TableNode subclass for tables inside list items; provisional escape item tracking |
| `src/editor/markdown/list_heading_shortcut.js` | 102 | Markdown shortcuts (`# `, `## `, `> `) inside list items → wrapped blocks |
| `test/browser/tests/block_editing/*.test.js` | 1,447 | 9 Playwright test files covering selection, drag-and-drop, movement, actions menu |

### Modified core files

| File | Delta | What changed | Could it live in the extension? |
|------|-------|--------------|---------------------------------|
| `src/editor/command_dispatcher.js` | +121 | Scroll preservation for block format commands; `SELECT_ALL_COMMAND` escalation to block mode; Tab in code blocks | **No.** These are command routing changes that affect all editors, not just block-select mode. Scroll preservation prevents page jumps during any heading/list/quote/code conversion. |
| `src/editor/contents.js` | +82 | Wrapped block creation: `#applyHeadingFormat`, `#applyCodeBlockFormat`, `#applyQuoteBlockFormat` now wrap content inside list items instead of replacing them. New helpers: `#findParentListItem`, `#wrapListItemInBlock`. | **No.** Determines how block formats interact with list structure — fundamental data model behavior. |
| `src/elements/editor.js` | +40 | `BlockSelectionExtension` registration, `block-handles` attribute, `selectAllBlocks()` public API, `#applyCodeSettings()`, extension lifecycle init/dispose. | **Partially.** The `block-handles` attribute and `selectAllBlocks()` API must be on the editor element. Extension registration is standard. `#applyCodeSettings()` for `--lexxy-code-tab-size` CSS variable could arguably stay in the extension. |
| `src/extensions/tables_extension.js` | +227 | Arrow-key escape from wrapped tables/code in lists; provisional ListItemNode creation/cleanup; `$handleWrappedBlockEscapeInList()`, `$isAtVisualEdge()`. | **Mostly yes.** Table escape logic is closely tied to the wrapped-block concept introduced by block editing. The escape handlers register at `COMMAND_PRIORITY_CRITICAL` which works fine from an extension. |
| `src/elements/table/table_controller.js` | +30 | Enter key in wrapped tables creates rows (not bailing for wrapper lists); `#isListNestedInCell()` distinguishes wrapper-list from cell-nested-list. | **No.** Enter key behavior inside tables is core table UX. The distinction between "table wrapped in a list item" vs "list nested in a table cell" must be handled in the controller. |
| `src/nodes/early_escape_code_node.js` | +12 | Code block exit creates sibling ListItemNode (not paragraph) when inside a list item. | **No.** Node-level behavior must be in the node class. |
| `src/elements/code_language_picker.js` | +99 | Copy button, hover-based visibility, `#monitorForCodeBlockHover()`. | **Could be.** The copy button and hover monitoring are independent of block selection. These are code block UX improvements that happened alongside this branch but aren't architecturally dependent on it. |
| `src/elements/toolbar.js` | +17 | Clears toolbar pressed states during block-select mode. | **Could be.** The extension could listen for mode changes and clear toolbar state, but it's simpler in toolbar.js since the toolbar already updates on selection changes. |
| `src/elements/toolbar_dropdown.js` | +22 | Deferred initialization via `queueMicrotask`. | **Yes.** This is a lifecycle bug fix for dynamic toolbar creation, not specific to block editing. |
| `src/elements/dropdown/highlight.js` | +27 | Saves last-used color via `BlockActionsMenu.saveLastUsedColor()`. | **Could be.** Cross-component color tracking, but touching extension UI code. |
| `src/elements/dropdown/link.js` | +3 | Renamed `connectedCallback` → `initialize()`. | **Yes.** Consistency refactor, not block-editing specific. |
| `src/config/lexxy.js` | +3 | Added `markdown: true` to default config. | **Yes.** Enables list-heading shortcuts but is a config default, not structural. |
| `src/helpers/lexical_helper.js` | +6 | Added `getListItemNode()` utility. | **Could be.** Small helper, but useful beyond block editing. |
| `src/extensions/highlight_extension.js` | +27 | Mark padding sync (`data-pad-start`/`data-pad-end` on `<mark>` elements). Corresponding CSS rules added to `lexxy-content.css`. | **Yes.** Visual polish for highlights, independent of block editing. |
| `app/assets/stylesheets/lexxy-editor.css` | +1,482 | All block selection visual styling. | **No.** Editor-level CSS must ship with the editor, not be injected by an extension. |
| `app/assets/stylesheets/lexxy-content.css` | +175 | Custom bullet rendering (radial-gradient markers), list margin/padding restructuring, code block spacing, attachment icon sizing. | **Partially.** The list bullet redesign (replacing browser markers with `::before` pseudo-elements) was necessary to enable block selection's left-gutter highlighting. The code block and attachment changes are independent improvements. |

### Changes that could potentially be kept in the extension

Based on the analysis above, candidates for moving back to the extension (or splitting into separate PRs):

1. **`toolbar_dropdown.js` lifecycle fix** — Generic bug fix, not block-editing specific. Could be a separate PR.
2. **`link.js` rename** — Consistency refactor, separate PR.
3. **`config/lexxy.js` markdown default** — Config change for list shortcuts, could ship independently.
4. **`code_language_picker.js` copy button + hover** — Code block UX improvements, independent feature.
5. **`highlight_extension.js` mark padding** — Visual polish, independent feature. CSS rules now added to `lexxy-content.css` (complete on this branch).
6. **`editor.js` `#applyCodeSettings()`** — The CSS variable for code tab-size could be set by the extension's `initializeEditor()` hook instead.

---

## Architecture

### Extension subsystems

The `BlockSelectionExtension` (4,027 lines) has 13 interconnected subsystems:

#### 1. Mode management
Dual-mode system: `"edit"` (normal text editing) and `"block-select"` (block-level operations). Escape toggles between them. Entering block-select adds `block-selection-active` to the editor root (hides caret, disables text selection via CSS). Exiting removes it and commits any pending highlight color changes.

#### 2. Selection state
- `#selectedBlockKeys` (Set) — currently selected node keys
- `#anchorKey` — first block selected (range anchor for Shift+Arrow)
- `#focusKey` — last block in selection (current focus)
- `#selectBlock(key, extend)` — select/toggle a single block
- `#selectRange(from, to)` — select contiguous range
- `#getNavigableBlockKeys()` — all top-level selectable blocks (excludes ListNode containers)
- Selection history maintained in parallel undo/redo stacks, synced with Lexical's history commands

#### 3. DOM synchronization
`#syncSelectionClasses()` diffs `#selectedBlockKeys` against `#previousSelectedKeys` and applies/removes `block--selected` and `block--focused` CSS classes. Diff-based for performance.

`#syncSelectionGroupClasses()` identifies contiguous runs of selected items and applies `block--select-first`, `block--select-mid`, `block--select-last` for flattened-edge group styling.

`#syncParentSelectionHeight()` sets `--parent-selection-height` CSS variable on parent items so the parent's `::after` pseudo-element can extend to cover all nested children as a unified highlight.

#### 4. Keyboard handling
Global `keydown` listener active only in block-select mode. Keybindings:

| Key | Action |
|-----|--------|
| Arrow Up/Down | Navigate selection (Shift to extend range) |
| Cmd+Shift+Up/Down | Move selected blocks |
| Enter | Enter edit mode on focused block |
| Escape | Exit block-select → blur editor |
| Tab / Shift+Tab | Indent / outdent |
| Backspace / Delete | Remove selected blocks |
| Cmd+A | Select all blocks |
| Cmd+D | Duplicate selected blocks |
| Cmd+B/I/U | Bold / italic / underline across selection |
| Cmd+Shift+X | Strikethrough |
| Cmd+Shift+H | Apply last-used highlight color |
| Cmd+/ | Open block actions menu |

#### 5. Block movement (single item)
`#moveSingleBlock` → `#moveListItem` → dispatches to:
- `#nestListItemUnderSibling` — nest under adjacent sibling (depth-first traversal)
- `#promoteListItem` — promote one nesting level
- `#promoteWrappedBlockThroughRoot` — wrapped blocks skip root list level and exit as standalone elements

#### 6. Block movement (atomic groups)
`#moveGroupAtomically` handles multi-block moves. Flow:

```
Cmd+Shift+Up/Down with group:
  ├─ Different parents?
  │   ├─ Any outside list or in root list → #moveRootLevelGroup (swap/enter)
  │   └─ Different depths in same hierarchy → #normalizeGroupDepth
  ├─ Has sibling in direction → #nestGroupUnderSibling
  └─ No sibling (boundary):
      ├─ Group IS entire root-level list → swap list as unit / enter adjacent list
      ├─ Root-level list → #exitGroupFromList
      └─ Nested list → #promoteGroupOneLevel
```

Key concepts:
- **Root keys**: `#filterToRootKeys` identifies the top-level items in the selection; children travel with their root via structural wrappers
- **Structural wrappers**: ListItemNodes containing only nested ListNodes — they carry child content when a parent item moves
- **Cursor approach**: `#exitGroupFromList` creates a temporary ParagraphNode as a stable reference point, places extracted items relative to it, then removes it (or keeps it as a separator to prevent Lexical's adjacent-list merge). When a retained separator is itself a decorator paragraph, subsequent group moves skip over it when computing the target index.
- **Batch exit**: consecutive regular items are collected into a single standalone list to prevent merge-induced infinite loops

#### 7. Drag-and-drop
`BlockDragAndDrop` (separate file, 2,135 lines) manages:
- Drag handle element with 6-dot grip icon, positioned on hover
- Add-block button (plus icon)
- Drop indicator: depth-aware positioning, gap resolution, center-aligned on the target edge; OL drop targets render `#.` rather than a bullet circle
- Drag ghost (translucent clone of dragged block, width matches source)
- Auto-scroll when dragging near container edges
- Multi-block drag (Shift+click, Cmd+click for range/toggle selection)
- Post-drop cleanup: removes empty ListItemNodes left behind by Lexical's normalization after an unwrap

#### 8. Block actions menu
`BlockActionsMenu` (separate file, 595 lines) — floating context menu opened via Cmd+/ or right-click:
- **Turn into**: paragraph, H2, H3, H4, bullets, numbers, quote, code
- **Color**: 9 highlight colors × 2 styles (text color, background color), plus last-used quick access
- **Delete**: remove selected blocks
- Full keyboard navigation (arrow keys, Enter, Escape)

#### 9. Highlight color management
Sophisticated color propagation system for nested list highlights:
- `#savedHighlightStyles` preserves original colors before parent propagation
- When a parent item gets a highlight, children inherit it
- When entering edit mode, new blocks don't inherit parent highlight
- `#applyOrRestoreParentHighlight` resolves whether to keep inherited color or revert to saved original
- CSS string parsing/merging handles complex `style=""` attribute manipulation

#### 10. Block type conversion
`#convertBlockType(command)` converts selected blocks between types. When blocks are inside list items, uses `#wrapListItemContent` to create wrapped blocks (heading-in-list, quote-in-list) rather than replacing the list item.

#### 11. Indent / outdent
Tab/Shift+Tab in block-select mode calls `#handleIndentOutdent`. For wrapped blocks (headings/quotes/code inside list items), uses special `#indentWrappedBlock` / `#outdentWrappedBlock` that manipulate the structural wrapper nesting. When a root-level item can't outdent further, `#flattenChildrenOneLevel` promotes children to siblings.

Shift+Tab on mixed root-level lists (wrapped blocks + regular bullets) extracts each wrapped item in place by splitting the list around it. Regular bullets stay in the naturally-formed list segments, preserving interleaved document order. `#exitGroupFromList` is still used for Cmd+Shift+Up boundary exit, but no longer for root-level outdent.

#### 12. Wrapped block escape
Tables and code blocks inside list items need special arrow-key escape. Registered in `tables_extension.js` at `COMMAND_PRIORITY_CRITICAL`:
- Arrow Up at top of table/code → creates provisional sibling ListItemNode above
- Arrow Down at bottom → creates provisional sibling below
- Provisional items auto-remove on selection change if left empty
- Backspace in a provisional returns focus to the adjacent table/code

#### 13. Bootstrap deferral
Every block-editing feature that doesn't affect initial render is deferred until the user actually touches the editor. On construction the extension wires a pair of one-shot listeners — `mouseenter` on the editor element and `focusin` on the root — and only on the first fire does it register its `registerCommand`s, keyboard handlers, and instantiate `BlockDragAndDrop`. The only work that stays in the bootstrap path is the bullet-marker node transform, because it needs to run during initial content reconciliation to style pre-existing lists.

Impact: removes 14 `registerCommand` calls, 1 `registerNodeTransform`, and several `addEventListener` calls per editor from the bootstrap path. This is load-bearing for the `bootstrap-many-editors` benchmark and why the per-editor cost stays close to the pre-branch baseline.

### Lexical list structure

```
ListNode (ul/ol)
  ListItemNode "Parent text"          ← content item (selectable block)
  ListItemNode [structural wrapper]   ← has class "lexxy-nested-listitem"
    ListNode (ul/ol)
      ListItemNode "Child text"       ← content item
      ListItemNode [heading wrapper]  ← wrapped block (contains H2)
```

- `$isStructuralWrapper(node)` — ListItemNode whose only children are ListNodes
- **Wrapped blocks** — ListItemNodes containing non-text block content (h1-h6, blockquote, code, table, HR, attachments). Detected by `#isWrappedBlock` via content heuristic, tracked key set, and DOM attribute fallback.
- When selecting a parent, its structural wrapper's children are automatically included in the selection

### CSS architecture

Selection highlighting uses `::after` pseudo-elements at `z-index: -1` as the primary mechanism, with per-block-type overrides:

| Block type | Technique | Why |
|------------|-----------|-----|
| Most blocks | `::after` pseudo-element | Standard approach, paints behind content |
| Code blocks | `z-index: auto` + outline + box-shadow tint | Code bg is opaque; breaking the stacking context lets `::after` paint below it |
| Tables | Direct background on wrapper + cells | Cell backgrounds are opaque; `::after` would be hidden |
| Blockquotes | `::before` bar at z-index: 1 over `::after` fill | Vertical bar must render above the highlight fill |
| HR | Compact `::after` with `min-height: unset` | Thin element needs minimal highlight |

**Contiguous group styling**: Adjacent selected items get `block--select-first/mid/last` classes for flattened-edge visual bands. Mixed lists (containing wrapped blocks) skip mid-styling because 4px gaps are too wide for flat-edge merging.

**Parent fill**: When a parent item and its children are all selected, the parent's `::after` extends to cover the entire subtree via `--parent-selection-height` CSS variable. Children's individual `::after` elements are hidden to avoid double-painting.

**List bullet redesign**: Browser default markers were replaced with `::before` pseudo-elements using radial-gradient bullets and CSS counter numbers. This was necessary because block selection's left-gutter highlight extends beyond the bullet position, and browser markers can't be styled to integrate with the highlight fill.

**Code block hover controls**: The copy button and language picker are hidden while block-select mode is active or a drag is in progress, so they don't paint on top of the block highlight or interfere with the drop target.

### Lexical reconciler caveats

- **Adjacent-list merge**: Lexical silently merges adjacent `ListNode`s of the same type during DOM reconciliation. Any operation that places two same-type lists next to each other will have them merged. Prevent by: (a) batching items into a single list, (b) keeping a ParagraphNode separator between lists.
- **Copy-on-write keys**: Lexical may change node keys during `editor.update()`. `#resyncWrappedKeys` handles some cases but stale keys can persist after group operations that create/destroy nodes.
- **CSS `:has()` nesting**: Browsers silently ignore nested `:has()` selectors. `ul:has(> li:has(> h2))` is dropped — must flatten to `ul:has(> li > h2)`.

### Public API additions

| API | Where | Purpose |
|-----|-------|---------|
| `editor.hasBlockSelection` | `editor.js` getter | Check if block-select mode is active |
| `editor.selectAllBlocks()` | `editor.js` method | Enter block-select mode with all blocks selected |
| `<lexxy-editor block-handles="true">` | HTML attribute | Enable/disable drag handles at runtime |

---

## Known limitations

1. **Undo/redo after group operations**: Lexical's history captures the changes but selection state restoration needs verification. Undo after group exit may not perfectly restore nesting levels.
2. **Selection tracking after key changes**: Lexical's copy-on-write may change node keys during updates. `#resyncWrappedKeys` handles some cases but group operations that create/destroy nodes may leave stale keys.
3. **Drag-and-drop into nested lists**: Depth-aware drop positioning now resolves the drop target based on cursor proximity to nesting columns, covering most nested cases. Extreme nesting (many levels deep) and drops at the exact boundary between two valid depths can still be ambiguous.

---

## Test coverage

8 Playwright test files in `test/browser/tests/block_editing/`:

| Test file | What it covers |
|-----------|---------------|
| `block_selection.test.js` | Multi-block selection via keyboard and click |
| `block_api.test.js` | Public API: `selectAllBlocks()`, `hasBlockSelection` |
| `block_actions_menu.test.js` | Context menu: turn-into, colors, delete |
| `block_drag_and_drop.test.js` | Drag handle positioning, drop targeting, reordering |
| `block_movement_hierarchy.test.js` | Nested list movement: nest, promote, exit, re-enter |
| `drop_debug.test.js` | Drag debug utilities |
| `drop_edge.test.js` | Edge cases: empty lists, single items |
| `drop_freeze.test.js` | Drag state freezing |
| `drop_reparent.test.js` | Re-parenting blocks across list hierarchies |
