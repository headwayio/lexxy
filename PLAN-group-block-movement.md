# Block Editing: Architecture & Implementation

> Notion-style block selection, movement, drag-and-drop, and formatting for Lexxy.
> Branch: `block-editing-standalone` — 98 files changed, 17,080 insertions, 387 deletions against `origin/main`.

## Overview

This branch adds a complete block editing system: multi-block selection with keyboard navigation, drag-and-drop reordering, block-level formatting (turn-into, highlight colors), and Cmd+Shift+Up/Down movement through arbitrarily nested list structures. The system is implemented primarily as an extension (`BlockSelectionExtension`, coordinator in `src/extensions/block_selection_extension.js`) with supporting modules under `src/editor/block_selection/` and changes to core lexxy infrastructure where required.

The design goal is Notion-style block semantics: every visible element (paragraph, heading, list item, table, code block, HR) is an individually selectable, movable block. Selected blocks highlight with a subtle fill, can be dragged as a group, and move through nested list hierarchies one step at a time.

---

## File inventory

### New files (extension layer)

| File                                                                                  | Lines  | Purpose                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extensions/block_selection_extension.js`                                         | 4,457  | Coordinator: selection state, keyboard navigation, block movement, formatting, highlight propagation — delegates drag-and-drop and a few independent concerns to the modules below                                        |
| `src/editor/block_selection/drag_and_drop/index.js`                                   | 1,973  | Drag-and-drop coordinator: drag handles, drop indicators, drag ghosts, hover detection                                                                                                                                    |
| `src/editor/block_selection/drag_and_drop/autoscroll.js`                              | 158    | `AutoScroll` class (edge-proximity scroll while dragging)                                                                                                                                                                 |
| `src/editor/block_selection/drag_and_drop/ghost.js`                                   | 103    | `DragGhost` class (translucent clone of the dragged block)                                                                                                                                                                |
| `src/editor/block_selection/drag_and_drop/drop_indicator.js`                          | 57     | `DropIndicator` DOM lifecycle                                                                                                                                                                                             |
| `src/editor/block_selection/drag_and_drop/geometry.js`                                | 59     | Snap-point / nesting-depth geometry helpers                                                                                                                                                                               |
| `src/editor/block_selection/wrapped_origin.js`                                        | 172    | `WrappedOriginTracker` class (user-vs-movement wrap origin)                                                                                                                                                               |
| `src/editor/block_selection/selection_history.js`                                     | 57     | `SelectionHistory` class (snapshot/restore for undo/redo)                                                                                                                                                                 |
| `src/editor/block_selection/highlight_css.js`                                         | 47     | `extract/merge/removeHighlightFromCSS` utilities for inline-style manipulation                                                                                                                                            |
| `src/editor/block_selection/bullet_color_sync.js`                                     | 60     | `registerBulletMarkerColorSync` (keep bullet markers colored to match text)                                                                                                                                               |
| `src/elements/block_actions_menu.js`                                                  | 658    | Floating context menu: turn-into, highlight colors, delete                                                                                                                                                                |
| `src/elements/attachment_controls.js`                                                 | 208    | Floating on-hover controls for attachments (open / collapse / edit / caption-toggle / delete); formerly `node_delete_button.js`                                                                                           |
| `src/elements/attachment_icons.js`                                                    | 41     | Shared SVG icon strings for attachment floating controls and preview modal chrome                                                                                                                                         |
| `src/elements/preview/dialog_builder.js`                                              | 214    | Shared preview-modal DOM builder used by the editor element and the standalone show-page script                                                                                                                           |
| `src/elements/preview/playback_sync.js`                                               | 53     | `attachPlaybackSync` + `installPauseOthers` — media playback coordination between inline players and the modal                                                                                                            |
| `src/preview/content_preview.js`                                                      | 52     | Rollup entry for `lexxy-content-preview.js` — the show-page script host apps import on pages that render ActionText content; thin wrapper around the shared preview modules                                               |
| `src/editor/block_helpers.js`                                                         | 38     | Shared CSS-class constants, `$isStructuralWrapper()`, and `getNodeKeyFromElement()` helpers                                                                                                                               |
| `src/nodes/wrapped_table_node.js`                                                     | 78     | TableNode subclass for tables inside list items; provisional escape item tracking                                                                                                                                         |
| `src/editor/markdown/list_heading_shortcut.js`                                        | 102    | Markdown shortcuts (`# `, `## `, `> `) inside list items → wrapped blocks                                                                                                                                                 |
| `lib/lexxy/attachment_helper.rb`                                                      | 110    | Helpers used by `_blob*.html.erb`: `lexxy_attachment_actions` (preview/download buttons), `lexxy_attachment_preview_caption`, `lexxy_attachment_file_caption`, `lexxy_inline_svg` (reads from `app/assets/images/lexxy/`) |
| `app/views/active_storage/blobs/_blob_{audio,file,image,inline_image,video}.html.erb` | ~30 ea | Per-type partials. `_blob.html.erb` is now a dispatcher that routes to the right partial based on `blob.video?` / `blob.audio?` / content type. Keeps each type's markup small and independently overridable              |
| `app/assets/images/lexxy/{preview,download}.svg`                                      | —      | SVG assets for the per-attachment action buttons, read via `lexxy_inline_svg`                                                                                                                                             |
| `test/browser/tests/block_editing/*.test.js`                                          | —      | 14 Playwright test files covering selection, drag-and-drop, movement, actions menu, wrapped blocks, undo correctness (see Test coverage below)                                                                            |

### Modified core files

| File                                       | Delta  | What changed                                                                                                                                                                                                                                                         | Could it live in the extension?                                                                                                                                                                                                                   |
| ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/editor/command_dispatcher.js`         | +121   | Scroll preservation for block format commands; `SELECT_ALL_COMMAND` escalation to block mode; Tab in code blocks                                                                                                                                                     | **No.** These are command routing changes that affect all editors, not just block-select mode. Scroll preservation prevents page jumps during any heading/list/quote/code conversion.                                                             |
| `src/editor/contents.js`                   | +73    | Wrapped block creation: `#applyHeadingFormat`, `#applyCodeBlockFormat`, `#applyQuoteBlockFormat` now wrap content inside list items instead of replacing them. Uses `getListItemNode` from `src/helpers/lexical_helper.js` plus a new `#wrapListItemInBlock` helper. | **No.** Determines how block formats interact with list structure — fundamental data model behavior.                                                                                                                                              |
| `src/elements/editor.js`                   | +37    | `BlockSelectionExtension` registration, `block-handles` attribute, `selectAllBlocks()` public API, `#applyCodeSettings()`, extension lifecycle init/dispose.                                                                                                         | **Partially.** The `block-handles` attribute and `selectAllBlocks()` API must be on the editor element. Extension registration is standard. `#applyCodeSettings()` for `--lexxy-code-tab-size` CSS variable could arguably stay in the extension. |
| `src/extensions/tables_extension.js`       | +227   | Arrow-key escape from wrapped tables/code in lists; provisional ListItemNode creation/cleanup; `$handleWrappedBlockEscapeInList()`, `$isAtVisualEdge()`.                                                                                                             | **Mostly yes.** Table escape logic is closely tied to the wrapped-block concept introduced by block editing. The escape handlers register at `COMMAND_PRIORITY_CRITICAL` which works fine from an extension.                                      |
| `src/elements/table/table_controller.js`   | +30    | Enter key in wrapped tables creates rows (not bailing for wrapper lists); `#isListNestedInCell()` distinguishes wrapper-list from cell-nested-list.                                                                                                                  | **No.** Enter key behavior inside tables is core table UX. The distinction between "table wrapped in a list item" vs "list nested in a table cell" must be handled in the controller.                                                             |
| `src/nodes/early_escape_code_node.js`      | +12    | Code block exit creates sibling ListItemNode (not paragraph) when inside a list item.                                                                                                                                                                                | **No.** Node-level behavior must be in the node class.                                                                                                                                                                                            |
| `src/elements/code_language_picker.js`     | +99    | Copy button, hover-based visibility, `#monitorForCodeBlockHover()`.                                                                                                                                                                                                  | **Could be.** The copy button and hover monitoring are independent of block selection. These are code block UX improvements that happened alongside this branch but aren't architecturally dependent on it.                                       |
| `src/elements/toolbar.js`                  | +38    | Clears toolbar pressed states during block-select mode.                                                                                                                                                                                                              | **Could be.** The extension could listen for mode changes and clear toolbar state, but it's simpler in toolbar.js since the toolbar already updates on selection changes.                                                                         |
| `src/elements/toolbar_dropdown.js`         | +32    | Deferred initialization via `queueMicrotask`.                                                                                                                                                                                                                        | **Yes.** This is a lifecycle bug fix for dynamic toolbar creation, not specific to block editing.                                                                                                                                                 |
| `src/elements/dropdown/highlight.js`       | +9     | Saves last-used color via `saveLastUsedColor()` (from `src/helpers/storage_helper.js`).                                                                                                                                                                              | **Could be.** Cross-component color tracking, but touching extension UI code.                                                                                                                                                                     |
| `src/elements/dropdown/link.js`            | +4     | Renamed `connectedCallback` → `initialize()`.                                                                                                                                                                                                                        | **Yes.** Consistency refactor, not block-editing specific.                                                                                                                                                                                        |
| `src/config/lexxy.js`                      | +6     | Added `markdown: true` to default config.                                                                                                                                                                                                                            | **Yes.** Enables list-heading shortcuts but is a config default, not structural.                                                                                                                                                                  |
| `src/helpers/lexical_helper.js`            | +6     | Added `getListItemNode()` utility.                                                                                                                                                                                                                                   | **Could be.** Small helper, but useful beyond block editing.                                                                                                                                                                                      |
| `src/extensions/highlight_extension.js`    | +27    | Mark padding sync (`data-pad-start`/`data-pad-end` on `<mark>` elements). Corresponding CSS rules added to `lexxy-content.css`.                                                                                                                                      | **Yes.** Visual polish for highlights, independent of block editing.                                                                                                                                                                              |
| `app/assets/stylesheets/lexxy-editor.css`  | +2,005 | All block selection visual styling.                                                                                                                                                                                                                                  | **No.** Editor-level CSS must ship with the editor, not be injected by an extension.                                                                                                                                                              |
| `app/assets/stylesheets/lexxy-content.css` | +431   | Custom bullet rendering (radial-gradient markers), list margin/padding restructuring, code block spacing, attachment icon sizing.                                                                                                                                    | **Partially.** The list bullet redesign (replacing browser markers with `::before` pseudo-elements) was necessary to enable block selection's left-gutter highlighting. The code block and attachment changes are independent improvements.       |

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

The `BlockSelectionExtension` (4,457 lines in `src/extensions/block_selection_extension.js`) has 13 interconnected subsystems. Independent concerns (drag-and-drop, wrapped-origin tracking, selection history, highlight CSS parsing, bullet color sync) live as sibling modules under `src/editor/block_selection/` — see the inventory above.

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

`#syncLeafInsets()` writes per-block `--leaf-top-inset` / `--leaf-bottom-inset` CSS variables computed by `#findAdjacentBlocks()` and `#computeLeafReach()`. Each selected leaf's `::after` reaches halfway to its nearest visible neighbor (skipping `.hidden` provisional separator paragraphs). Adjacent selected leaves compute from the same box-distance on both sides, producing an exact 4px gap between highlights — independent of how many leaves are selected.

`#syncParentSelectionHeight()` sets `--parent-selection-height` on parent items so the parent's `::after` extends to cover all nested children as a unified highlight. The bottom uses the last child's computed `bottomReach` so the parent-takeover highlight ends exactly where that last child's individual highlight would have — heights stay stable as the selection grows from leaf → group → parent.

#### 4. Keyboard handling

Global `keydown` listener active only in block-select mode. Keybindings:

| Key                | Action                                     |
| ------------------ | ------------------------------------------ |
| Arrow Up/Down      | Navigate selection (Shift to extend range) |
| Cmd+Shift+Up/Down  | Move selected blocks                       |
| Enter              | Enter edit mode on focused block           |
| Escape             | Exit block-select → blur editor            |
| Tab / Shift+Tab    | Indent / outdent                           |
| Backspace / Delete | Remove selected blocks                     |
| Cmd+A              | Select all blocks                          |
| Cmd+D              | Duplicate selected blocks                  |
| Cmd+B/I/U          | Bold / italic / underline across selection |
| Cmd+Shift+X        | Strikethrough                              |
| Cmd+Shift+H        | Apply last-used highlight color            |
| Cmd+/              | Open block actions menu                    |

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

`BlockDragAndDrop` (`src/editor/block_selection/drag_and_drop/index.js`, 1,973 lines plus 4 sibling modules totaling ~380 more lines) manages:

- Drag handle element with 6-dot grip icon, positioned on hover
- Add-block button (plus icon)
- Drop indicator: depth-aware positioning, gap resolution, center-aligned on the target edge; OL drop targets render `#.` rather than a bullet circle
- Drag ghost (translucent clone of dragged block, width matches source)
- Auto-scroll when dragging near container edges
- Multi-block drag (Shift+click, Cmd+click for range/toggle selection)
- Post-drop cleanup: removes empty ListItemNodes left behind by Lexical's normalization after an unwrap

#### 8. Block actions menu

`BlockActionsMenu` (`src/elements/block_actions_menu.js`, 658 lines) — floating context menu opened via Cmd+/ or right-click:

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

| Block type  | Technique                                        | Why                                                                            |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Most blocks | `::after` pseudo-element                         | Standard approach, paints behind content                                       |
| Code blocks | `z-index: auto` + outline + box-shadow tint      | Code bg is opaque; breaking the stacking context lets `::after` paint below it |
| Tables      | Direct background on wrapper + cells             | Cell backgrounds are opaque; `::after` would be hidden                         |
| Blockquotes | `::before` bar at z-index: 1 over `::after` fill | Vertical bar must render above the highlight fill                              |
| HR          | Compact `::after` with `min-height: unset`       | Thin element needs minimal highlight                                           |

**Contiguous group styling**: Adjacent selected items get `block--select-first/mid/last` classes for flattened-edge visual bands. Mixed lists (containing wrapped blocks) skip mid-styling because 4px gaps are too wide for flat-edge merging.

**Parent fill**: When a parent item and its children are all selected, the parent's `::after` extends to cover the entire subtree via `--parent-selection-height` CSS variable. Children's individual `::after` elements are hidden to avoid double-painting.

**Layout-shift-free selection**: Selection CSS must never toggle flow properties (margin, padding, height). Only `::after` geometry and background/color respond to `.selected`. Wrapper list items (`lexxy-nested-listitem`) establish a block formatting context via `display: flow-root` so nested wrapped-block margins stay trapped inside the wrapper rather than collapsing up through empty ancestors and inflating the outer list.

**Halfway-reach invariant for isolated leaves**: Every selected `li` / `figure.attachment` / `.attachment-gallery` gets `--leaf-top-inset` and `--leaf-bottom-inset` pre-computed as halfway-to-neighbor. Adjacent selected pairs always meet at a 4px gap; solo selections reach to the midpoint on each side. `.hidden` provisional paragraphs (Lexical's decorator separators) are skipped during adjacency walks so inter-decorator pairs reach each other directly instead of landing on invisible separators.

**List bullet redesign**: Browser default markers were replaced with `::before` pseudo-elements using radial-gradient bullets and CSS counter numbers. This was necessary because block selection's left-gutter highlight extends beyond the bullet position, and browser markers can't be styled to integrate with the highlight fill.

**Code block hover controls**: The copy button and language picker are hidden while block-select mode is active or a drag is in progress, so they don't paint on top of the block highlight or interfere with the drop target.

### Lexical reconciler caveats

- **Adjacent-list merge**: Lexical silently merges adjacent `ListNode`s of the same type during DOM reconciliation. Any operation that places two same-type lists next to each other will have them merged. Prevent by: (a) batching items into a single list, (b) keeping a ParagraphNode separator between lists.
- **Copy-on-write keys**: Lexical may change node keys during `editor.update()`. `#resyncWrappedKeys` handles some cases but stale keys can persist after group operations that create/destroy nodes.
- **CSS `:has()` nesting**: Browsers silently ignore nested `:has()` selectors. `ul:has(> li:has(> h2))` is dropped — must flatten to `ul:has(> li > h2)`.
- **Provisional paragraphs between decorators**: Lexical inserts empty `<p class="hidden">` separator paragraphs between adjacent `DecoratorNode`s so the cursor can land between them. Any adjacency math over editor DOM must skip these or it measures to an invisible box (with a `-5.5px` compensation margin) and computes the wrong neighbor distance.

### Public API additions

| API                                   | Where              | Purpose                                          |
| ------------------------------------- | ------------------ | ------------------------------------------------ |
| `editor.hasBlockSelection`            | `editor.js` getter | Check if block-select mode is active             |
| `editor.selectAllBlocks()`            | `editor.js` method | Enter block-select mode with all blocks selected |
| `<lexxy-editor block-handles="true">` | HTML attribute     | Enable/disable drag handles at runtime           |

---

## Attachment rendering & media features

### Show page rendering (blob template)

Lexxy ships `app/views/active_storage/blobs/_blob.html.erb` as a dispatcher plus per-type partials (`_blob_audio`, `_blob_file`, `_blob_image`, `_blob_inline_image`, `_blob_video`). `_blob.html.erb` picks the right partial based on `blob.video?` / `blob.audio?` / content type. Each per-type partial stays small and is independently overridable. Out-of-the-box rendering:

| Content type                          | Rendering                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Video (mp4, webm, mov, mkv, avi)      | `<video controls>`                                                                                                             |
| Audio (mp3, wav, ogg, flac, m4a, aac) | File card with inline `<audio controls>` player below                                                                          |
| GIF, animated WebP/AVIF, SVG          | `<img>` using direct blob URL (preserves animation/vector data — `blob.representation` would strip animation or rasterize SVG) |
| Other images (png, jpg, etc.)         | `<img>` via Active Storage representation (resize-to-limit)                                                                    |
| PDF                                   | Image thumbnail representation (first-page preview)                                                                            |
| Other files                           | File card with icon + filename + size                                                                                          |

The `blob.video?` and `blob.audio?` checks match any `video/*` or `audio/*` content type, so unusual variants (mkv, flac, etc.) are handled automatically. The icon-label helper falls back to the uppercased extension for any type not in `ICON_LABELS`, so file cards always have a sensible label without needing a code change.

All attachment types render with **Open** (eye icon) and **download** action buttons that appear on hover. Open dispatches `lexxy:preview-attachment` to the modal; download triggers the browser's download flow. The eye button is hidden by default and only shown after `lexxy-content-preview.js` adds `lexxy-content-preview-enabled` to `<html>` — apps that skip the import get a download-only action bar and can roll their own preview UI.

### Preview modal (`lexxy-content-preview.js`)

Standalone script for show pages. Source at `src/preview/content_preview.js`; rollup emits `app/assets/javascript/lexxy-content-preview.js` alongside `lexxy.js`. The editor's `<lexxy-preview-modal>` custom element and this script share **all** modal-building logic via `src/elements/preview/dialog_builder.js` and `src/elements/preview/playback_sync.js` — both modals render and behave identically.

Provides:

- Full-screen `<dialog>` modal with header (icon, caption, filename, file size) + content area
- Content-type detection: image zoom, video player, audio player, PDF iframe, generic download fallback
- Two-line header: shows custom caption as title with filename + size as subtitle (or filename as title with size below)
- Playback time sync: opening modal from an inline player carries over `currentTime`; closing syncs it back. If the page media was playing, modal continues from the same spot.
- Pause-others: playing any media element pauses all other video/audio on the page (`installPauseOthers()` from `playback_sync.js`)
- Turbo-compatible via `turbo:load` listener

**Host app integration** — minimal:

```ruby
# config/importmap.rb
pin "lexxy", to: "lexxy.js"
pin "lexxy-content-preview", to: "lexxy-content-preview.js"  # only for show-page modal
```

```javascript
// app/javascript/application.js
import "lexxy";
import "lexxy-content-preview"; // optional; opts into show-page modal & preview button
```

The `previewModal: true` flag for the editor modal is now the default — no `configure()` call needed. Apps that want to opt out can set `previewModal: false`.

If the app has a custom `app/views/active_storage/blobs/_blob.html.erb`, delete it (and delete any per-type partials) to use Lexxy's. The Lexxy gem ships:

- `lib/lexxy/attachment_helper.rb` (`lexxy_attachment_actions` — preview/download button row, `lexxy_attachment_preview_caption`, `lexxy_attachment_file_caption`, `lexxy_inline_svg` — reads from `app/assets/images/lexxy/`)

The helper module is auto-included into `ActionView::Base` by `Lexxy::Engine`, so the partials just call its methods. Icon labels are now just `extension.upcase` inline in the partials — no separate Ruby icon-label map.

### Attachment state persistence

Two new data attributes on `action-text-attachment` elements persist editor state to the rendered page:

| Attribute             | Effect in editor                                                        | Effect on show page                                           |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `data-collapsed`      | Hides preview, shows file card                                          | Hides media, renders as file card with icon + filename + size |
| `data-caption-hidden` | Hides caption on images; shows filename instead of custom name on files | Same behavior via CSS + JS                                    |

**Pipeline for persistence:**

1. Editor → Lexical node properties (`collapsed`, `captionHidden`)
2. `exportDOM()` → data attributes on `action-text-attachment` element
3. DOMPurify client-side allowlist (so attributes survive value serialization)
4. `ActionText::Attachment::ATTRIBUTES` (so attributes survive server-side re-serialization)
5. `ActionText::ContentHelper.allowed_attributes` (so attributes survive render-time sanitization)
6. CSS attribute selectors + JS on the show page apply the visual state

### Editor attachment controls (`<lexxy-attachment-controls>`)

Custom element at `src/elements/attachment_controls.js` (formerly `node_delete_button.js` — renamed since it grew well beyond the delete button). Floating controls appear on hover and selection. All buttons have native browser tooltips via `title` plus matching `aria-label`. Button order:

| Button                      | Preview attachments                                       | File attachments                                 | Tooltip                               |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| Open (eye)                  | Opens modal                                               | Opens modal                                      | "Open"                                |
| Collapse (chevron)          | Toggles preview ↔ card                                    | — (already a card)                               | "Collapse preview" / "Expand preview" |
| Edit (pencil)               | Focuses caption editor (textarea or click-to-rename name) | Click-to-edit inline filename                    | "Edit name"                           |
| Caption toggle (text lines) | Show/hide caption below media                             | Toggle between custom name and original filename | "Hide caption" / "Show caption"       |
| Delete (trash)              | Remove attachment                                         | Remove attachment                                | "Remove"                              |

**Naming note**: We use **"Open"** for the eye icon to disambiguate from the inline "preview" (which the collapse button toggles). Internally the code/event names still use "preview" (`#openPreview`, `lexxy:preview-attachment`, `PreviewModal`, etc.) — only user-visible strings changed.

**Audio preview in editor**: Audio attachments render as a file card with an inline `<audio>` player below (the same `attachment--audio` layout as the show page). Collapse hides the player; expand shows it. The collapsed state persists to the show page.

**Inline video preview in editor**: Video attachments render as a `<video controls>` player (using the derived blob URL via `representationToBlobUrl()` in `storage_helper.js`). Collapse switches to the file card.

**PDF preview in editor**: PDFs render with their thumbnail image (representation URL). Collapse switches to the file card.

**Inline name editing**: Click any file attachment's filename (`.attachment__name`) to edit it inline. Enter saves (auto-enables caption display). Escape clears and resets to original filename. The edited name is stored as the `caption` attribute. The click-to-edit listener lives on `#createNameTag()` itself, so every layout that renders a name (file cards, audio preview, collapsed card view) gets the behaviour for free.

**Gallery ejection**: Collapsed images are automatically ejected from image galleries since `ImageGalleryNode.isValidChild()` excludes collapsed nodes. The gallery's `splitAroundInvalidChild` transform handles the ejection.

### Shared building blocks (DRY composition)

`ActionTextAttachmentNode#createDOM` composes a small set of reusable methods:

| Method                                                                   | Purpose                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `#createIconLabel()`                                                     | Extension badge (MP4, PDF, XLS, etc.)                                                      |
| `#createNameTag()`                                                       | Display name `<strong>` with click-to-rename wired in                                      |
| `#createFileCaption()`                                                   | `<figcaption>` with name + size — used by file cards and the audio preview's file-info row |
| `#createEditableCaption()`                                               | `<textarea>` caption for image/video previews                                              |
| `#createDOMForImage()` / `#createAudioPlayer()` / `#createVideoPlayer()` | The media element itself                                                                   |
| `#createCardView()`                                                      | Collapsed-state card (icon + name + subtitle)                                              |

The same `playbackUrl` getter resolves the right URL for inline players and the modal — `blobUrl` (if known), otherwise `representationToBlobUrl(src)`, otherwise `src`. The blob URL is stored on the figure's `data-caption` attribute (via `updateDOM`) so the preview button can read the authoritative caption regardless of caption-hidden state.

### Sanitization configuration (all in `engine.rb`)

Three layers must agree for new attributes to survive the round-trip:

```ruby
# 1. Render-time sanitization (server-side, every page render)
ActionText::ContentHelper.allowed_tags += %w[
  video audio source table tbody tr th td
  svg path circle ellipse line polyline polygon rect g defs use text tspan title desc
  linearGradient radialGradient stop clipPath mask pattern symbol marker
]
ActionText::ContentHelper.allowed_attributes += %w[
  controls poster data-language style value autoplay loop muted playsinline preload
  viewBox xmlns d fill aria-label
  cx cy r rx ry x y x1 y1 x2 y2 points transform stroke stroke-width stroke-linecap stroke-linejoin
  stroke-dasharray stroke-dashoffset stroke-opacity fill-opacity opacity offset stop-color stop-opacity
  gradientUnits gradientTransform spreadMethod patternUnits patternTransform clip-path mask
  font-family font-size font-weight text-anchor dominant-baseline preserveAspectRatio
  data-collapsed data-caption-hidden
]

# Narrowed from an earlier iteration that also allowed `embed`, `download`,
# `target`, and `title` — all dropped to reduce XSS surface since nothing
# the editor emits needs them.

# Also needed for CSS var() references inside style="" (highlight colors etc.)
Loofah::HTML5::SafeList::ALLOWED_CSS_FUNCTIONS << "var"

# 2. ActionText attachment re-serialization (server-side, on save)
ActionText::Attachment::ATTRIBUTES.push("data-collapsed", "data-caption-hidden")
```

```javascript
// 3. Client-side DOMPurify (src/config/dom_purify.js)
// Without this the editor's exported HTML loses these attributes before
// reaching the server.
ALLOWED_HTML_ATTRIBUTES includes: data-collapsed, data-caption-hidden
```

If you add a new persisted attribute on `action-text-attachment`, update **all three** layers or it will silently disappear.

### Icon color system

Per-extension icon colors using CSS custom properties (`--lexxy-attachment-icon-bg`, `--lexxy-attachment-icon-border`, `--lexxy-attachment-icon-text`). Defined in three places:

1. `lexxy-editor.css` inside `:where(lexxy-editor)` — editor file cards and collapsed cards
2. `lexxy-editor.css` outside `:where()` — preview modal icons (appended to `document.body`)
3. `lexxy-content.css` — show page rendering

---

## Drag-and-drop improvements

### Block handle drag

- **Preserved selection outlines**: CSS rule `.lexxy-block-dragging .attachment:hover` narrowed with `:not(.node--selected):not(.lexxy-dragging)` so selected and dragged attachments keep their blue outlines
- **Esc snap-back animation**: `#cancelDragWithSnapBack()` animates the ghost from cursor position back to the original element with a 200ms ease transition + fade, then cleans up
- **Clear non-dragged selection**: `#startDrag()` removes `node--selected` from all elements except the one being dragged
- **Hover controls**: Attachment floating controls now appear on hover (`.attachment:hover &`) in addition to selection

### Attachment native drag (`AttachmentDragAndDrop`)

The native HTML5 drag system remains active for gallery operations (merging images, reordering within galleries). Block-level moves are handled by `BlockDragAndDrop`.

---

## Host app integration (testing uploads & previews)

Everything in this section is what a Rails app needs so a human can manually drive the editor through the full matrix of attachment types and the preview modal. `test/dummy/` in this repo is a working reference; copy from it when bootstrapping a new test app.

### The engine takes care of the server side

`Lexxy::Engine` auto-wires these when the gem is mounted — the host app doesn't touch sanitizer config itself:

- `ActionText::Attachment::ATTRIBUTES` gains `data-caption-hidden` and `data-collapsed` so the editor's UI state persists through the save → render → re-edit round-trip.
- `ActionText::ContentHelper.allowed_tags` gains `video`, `audio`, `source`, `table`, `tbody`, `tr`, `th`, `td`, plus the full SVG-primitive set (`svg path circle ellipse line polyline polygon rect g defs use text tspan title desc linearGradient radialGradient stop clipPath mask pattern symbol marker`).
- `ActionText::ContentHelper.allowed_attributes` gains the core editor attributes (`controls poster data-language style value autoplay loop muted playsinline preload`), the data attributes the editor persists (`data-collapsed data-caption-hidden`), and the SVG attribute set (`viewBox xmlns d fill aria-label cx cy r rx ry x y x1 y1 x2 y2 points transform stroke stroke-*` and related). The full list is in `lib/lexxy/engine.rb`.
- `Loofah::HTML5::SafeList::ALLOWED_CSS_FUNCTIONS` gains `var` so `--lexxy-*` CSS variables survive sanitization.
- `ActiveStorage::Blob#as_json` is patched to include `previewable: true` and a `url` pointing at a resized representation (`ActiveStorage::BlobWithPreviewUrl`). This is the signal the editor uses to decide preview-view vs. file-card rendering for PDFs, videos, etc.
- `rich_text_area` form helper is installed via `Lexxy::FormHelper` / `FormBuilder`.

### Preview modal is opt-in (and has two separate switches)

| Where                                                                         | How to enable                                                                            | Scope                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inside the editor (double-click or eye button on an attachment while editing) | `Lexxy.configure({ global: { previewModal: true } })` before any editors connect         | Registers `<lexxy-preview-modal>` and appends one to `document.body`. Without this, the editor's preview button dispatches `lexxy:preview-attachment` but nothing handles it and the click is a no-op. |
| On rendered show pages (eye button on rendered `<action-text-attachment>`)    | `import "lexxy-content-preview"` in `application.js` (and a corresponding importmap pin) | Standalone script that attaches modal behaviour to rendered content. Independent from the editor-side switch — apps can enable one, the other, both, or neither.                                       |

Default is `previewModal: false` for both. For a test app that exercises this PR's full feature set, enable both.

### Minimum Gemfile

```ruby
gem "rails"
gem "propshaft"             # or sprockets
gem "importmap-rails"       # or jsbundling — lexxy supports either
gem "turbo-rails"
gem "actiontext", require: "action_text"
gem "activestorage"
gem "image_processing"      # needed for Active Storage representations
gem "lexxy"
```

Then run `bin/rails action_text:install` and `bin/rails active_storage:install`, and run the resulting migrations.

### JavaScript wiring

`config/importmap.rb`:

```ruby
pin "application"
pin "@rails/actiontext",        to: "actiontext.esm.js"
pin "@rails/activestorage",     to: "activestorage.esm.js"
pin "@hotwired/turbo-rails",    to: "turbo.min.js"
pin "lexxy",                    to: "lexxy.js"
pin "lexxy-content-preview",    to: "lexxy-content-preview.js"  # only if show pages should open previews
```

`app/javascript/application.js`:

```js
import "@rails/actiontext";
import * as ActiveStorage from "@rails/activestorage";
ActiveStorage.start();
import "@hotwired/turbo-rails";
import "lexxy";
import "lexxy-content-preview"; // show-page modal
Lexxy.configure({ global: { previewModal: true } }); // editor-side modal
```

### Stylesheet

`<%= stylesheet_link_tag "lexxy" %>` in the layout — that file `@import`s `lexxy-content.css` (show-page rules), `lexxy-editor.css` (editor chrome + block editing styles), and `lexxy-variables.css` (custom properties).

### Show page template

Lexxy ships `app/views/active_storage/blobs/_blob.html.erb` with rendering for video, audio, GIF, image representations, and generic file cards plus preview + download action buttons. If the host app has its own override for this partial, **delete it** — Lexxy's version is required for the attachment action buttons and consistent markup across the matrix. Rendering stays a normal `<%= @post.body %>`.

### System dependencies for attachment types

`blob.previewable?` drives whether an upload gets the preview-view DOM or falls back to a file card. It depends on processors being installed on the machine running the test app:

| Attachment type                  | Needs                                     | What you lose without it                                  |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| PNG / JPG / WEBP                 | libvips (preferred) or ImageMagick        | Representations; editor falls back to the direct blob URL |
| Animated GIF                     | Nothing extra                             | —                                                         |
| PDF                              | poppler (`brew install poppler`) or mupdf | Preview thumbnail — falls back to file card               |
| Video (mp4 / webm / mov)         | ffmpeg                                    | Poster frame — falls back to file card                    |
| Audio (mp3 / wav / ogg)          | ffmpeg                                    | Metadata; audio still plays inline via `<audio>`          |
| Other files (txt / zip / xlsx …) | Nothing extra                             | —                                                         |

Set the processor explicitly in `config/environments/development.rb`:

```ruby
config.active_storage.variant_processor = :vips   # or :mini_magick
```

Also set `Rails.application.routes.default_url_options = { host: "localhost", port: 3000 }` so representations resolve to absolute URLs in the show-page preview modal.

### Model + form

```ruby
class Post < ApplicationRecord
  has_rich_text :body
end
```

```erb
<%= form_with model: @post do |f| %>
  <%= f.rich_text_area :body %>                                   <%# default editor %>
  <%# or, to exercise block editing: %>
  <%# <%= f.rich_text_area :body, data: { block_handles: "true" } %> %>
<% end %>
```

### Manual test matrix

With the above wired up, walk through:

1. Upload each: `.png`, `.gif`, `.pdf`, `.mp4`, `.mp3`, `.txt`, `.zip`. Confirm image/GIF/video/PDF all render as preview-view with a real thumbnail, audio renders as a file card with an inline `<audio>` player, and the rest render as file cards with an extension label.
2. Hover an attachment — confirm all five floating controls appear (preview, collapse, edit, caption toggle, delete).
3. Click the collapse button on an image — it flips to card view; reload the show page — the `data-collapsed` attribute survives and the card renders there too.
4. Click the caption toggle — caption hides/shows; verify `data-caption-hidden` round-trips.
5. Click the preview (eye) button — modal opens; video/audio playback time carries over from inline to modal and back; Escape and Space work via `<dialog>`'s native handling.
6. Open the show page, click the preview button on a rendered attachment — the show-page modal opens (proves `lexxy-content-preview` is wired).
7. Toggle `block-handles="true"` on the editor — drag handle appears on hover over each block; verify Cmd+Shift+↑/↓ movement, Cmd+/ block actions menu, and drag-and-drop all work with attachments as blocks.

---

## Test coverage

14 Playwright test files in `test/browser/tests/block_editing/`:

| Test file                          | What it covers                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `block_selection.test.js`          | Multi-block selection via keyboard and click                                                                                   |
| `block_api.test.js`                | Public API: `selectAllBlocks()`, `hasBlockSelection`                                                                           |
| `block_actions_menu.test.js`       | Context menu: turn-into, colors, delete                                                                                        |
| `block_drag_and_drop.test.js`      | Drag handle positioning, drop targeting, reordering                                                                            |
| `block_movement_hierarchy.test.js` | Nested list movement: nest, promote, exit, re-enter                                                                            |
| `drop_edge.test.js`                | Edge cases: empty lists, single items                                                                                          |
| `drop_freeze.test.js`              | Drag state freezing                                                                                                            |
| `drop_reparent.test.js`            | Re-parenting blocks across list hierarchies                                                                                    |
| `attachment_block_select.test.js`  | Attachment interactions while in block-select mode                                                                             |
| `hr_block_select.test.js`          | HR (horizontal rule) as a first-class block: select, wrap in list, move                                                        |
| `table_block_select.test.js`       | Tables as wrappable blocks: multi-block wrap, Shift+Tab extract, group move                                                    |
| `single_undo_correctness.test.js`  | One Cmd+Z reverts the full pre-action shape for Turn Into, Remove, and group moves (guards against HISTORY_MERGE_TAG trap)     |
| `wrapped_block_origin.test.js`     | User-wrapped vs movement-wrapped origin: wrapped heading stays wrapped after move; movement-wrapped auto-unwraps on arrow-back |
| `wrapped_block_outdent.test.js`    | Shift+Tab at root: split-through extract of mixed wrapped/plain items, single-heading unwrap, single-quote unwrap              |
