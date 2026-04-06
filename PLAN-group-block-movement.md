# Group Block Movement Plan

## Current State (updated 2026-04-06)

### What's been implemented
- **Depth-first group traversal** (`#nestGroupUnderSibling`): groups nest under the adjacent sibling on each keypress, matching single-item movement. DOWN nests as first children; UP nests as last children. Maintains document order.
- **Boundary promotion** (`#promoteGroupOneLevel`): when no sibling exists in the move direction, the group promotes one level per keypress. Walks through every nesting level — no shortcuts.
- **List exit** (`#exitGroupFromList`): cursor paragraph approach for root-level exit. Regular bullets retain bullet status in standalone lists; wrapped blocks (headings, blockquotes, code, tables, HR, attachments) are extracted as standalone elements.
- **List re-entry**: moving UP past a cursor separator into an adjacent list re-enters the list via `#moveGroupIntoList`. Standalone lists have items extracted; non-list blocks get wrapped in ListItemNodes.
- **Root-level mixed group movement** (`#moveRootLevelGroup`): after list exit, selected items may span standalone lists and standalone blocks. Resolves to root-level elements for correct swapping and list re-entry.
- **Mixed-depth normalization** (`#normalizeGroupDepth`): when selected items span different nesting depths within a list, promotes the deeper items to the shallowest level before moving horizontally.
- **DecoratorNode support**: `#extractWrappedContent` and `#isWrappedBlock` handle DecoratorNodes (HR, images, attachments) alongside ElementNodes. ImageGalleryNode (ElementNode) already covered.
- **Bullet preservation**: cursor kept as separator paragraph when source list survives DOWN exit to prevent Lexical's adjacent-list merge.
- **Empty LI cleanup**: `#promoteGroupOneLevel` prunes Lexical placeholder empty LIs after promotion.
- **Shift+Tab flatten** (`#flattenChildrenOneLevel`): when a root-level parent can't outdent further, promotes children to siblings one nesting level per press.
- **Shift+down descendant jump**: fallback in `#getLastDescendantKey` and guard against re-selecting already-selected items.

### Selection styling (CSS)
- **HR**: thin strip with `padding: 4px 0`, `margin: 10px 0` for 4px gaps from neighbors.
- **Blockquote**: `::before` at `z-index: 1` renders the vertical bar on top of the `::after` fill. Bar color `oklch(70% 0 0)` (~25% darker than unselected). `::after` left inset compensates for border width.
- **Code block**: `z-index: auto` so `::after` paints behind opaque bg. `10px` border-radius always. `7px` solid outline in selection fill color. Subtle `box-shadow` tint (7% accent). Wrapped code blocks get matching tint and custom `li::after` with `10px` rounding and `-39px` left inset.
- **Table**: padding+background approach with always-on `padding: 7px` and compensating negative margins so selection doesn't shift content. `::after` suppressed. Cell backgrounds tinted. Wrapped tables use `li::after` with `17px` margin for spacing.

### What's still broken / needs work
1. **Wrapped table/code inside lists — movement**: moving a wrapped table or code block up/down within a list may have edge cases with the custom `::after` styling not updating correctly.
2. **Undo/redo after group operations**: not tested — Lexical's history should capture the changes but selection state restoration needs verification. Known issue: undo after group exit doesn't perfectly restore nesting levels.
3. **Selection tracking after key changes**: Lexical's copy-on-write may change node keys during updates. `#resyncWrappedKeys` handles some cases but group operations that create/destroy nodes may leave stale keys.

## Architecture

### Key files
- `src/extensions/block_selection_extension.js` — All selection and movement logic
- `src/editor/block_helpers.js` — Constants and `$isStructuralWrapper()` helper
- `app/assets/stylesheets/lexxy-editor.css` — Block selection styling

### Key methods (movement)
- `#moveSelectedBlocks(direction)` — Entry point for Cmd+Shift+Up/Down
- `#moveGroupAtomically(rootKeys, direction)` — Detects context (same-parent, mixed-depth, root-level) and dispatches
- `#nestGroupUnderSibling(group, target, direction)` — Nests group under adjacent sibling (depth-first traversal)
- `#moveGroupAtBoundary(group, direction)` — Routes to exit or nested promotion at list edges
- `#exitGroupFromList(group, sourceList, direction)` — Two-phase cursor approach for root exit
- `#promoteGroupOneLevel(group, currentList, direction)` — Nested list promotion (one level per call)
- `#normalizeGroupDepth(group, direction)` — Promotes deeper items to shallowest level when group spans multiple depths
- `#moveGroupIntoList(group, targetList, direction)` — Group enters adjacent list at root level
- `#moveRootLevelGroup(resolved, originalGroup, direction)` — Moves root-level mixed groups (standalone lists + blocks)
- `#moveSingleBlock(nodeKey, direction)` — Single-item move (used when rootKeys.length === 1)
- `#moveListItem(node, direction)` — Decides: nest under sibling OR promote to parent level
- `#nestListItemUnderSibling(node, sibling, ...)` — Makes item a child of adjacent sibling
- `#promoteListItem(node, currentList, isDown)` — Moves item up one nesting level
- `#promoteWrappedBlockThroughRoot(...)` — Special exit for wrapped blocks (headings, blockquotes)
- `#filterToRootKeys(selectedKeys)` — Identifies "root" items whose children travel via structural wrappers
- `#flattenChildrenOneLevel(node)` — Shift+Tab: promotes children to siblings

### Key methods (selection styling — CSS)
- `.block--selected::after` — Generic selection fill (z-index: -1, 3px radius)
- Code blocks: `z-index: auto` + outline + box-shadow tint
- Tables: always-on padding/margin + background toggle + `::after` suppressed
- Blockquotes: `::before` bar at z-index: 1 + `::after` left inset compensation
- HR: compact `::after` with `min-height: unset`

### Lexical list structure
```
ListNode (ul/ol)
  ListItemNode "Parent text"          ← content item
  ListItemNode [structural wrapper]   ← has class "lexxy-nested-listitem"
    ListNode (ul/ol)
      ListItemNode "Child text"       ← content item
      ListItemNode [heading wrapper]  ← wrapped block (contains H2)
```

- `$isStructuralWrapper(node)` returns true for ListItemNodes whose only children are ListNodes
- Wrapped blocks: ListItemNodes containing non-text content (h1-h6, blockquote, code, table, HR, attachments, etc.)
- `#isWrappedBlock(node)` detects these by checking for block-level child elements or DecoratorNodes

### Group movement flow
```
Cmd+Shift+Down with group selected:
  ├─ All in same list, has next sibling → nest under sibling (#nestGroupUnderSibling)
  ├─ All in same list, no next sibling → promote one level (#promoteGroupOneLevel)
  ├─ At root level of list, no sibling → exit list (#exitGroupFromList)
  ├─ Mixed depths within list → normalize to shallowest (#normalizeGroupDepth)
  ├─ Root-level mixed group → resolve + swap/enter list (#moveRootLevelGroup)
  └─ Root-level, target is list → enter list (#moveGroupIntoList)
```

### CSS stacking context notes
- `.block--selected` sets `position: relative; z-index: 0` creating a stacking context
- `::after` at `z-index: -1` paints ABOVE the element's background/borders in that context (CSS spec: backgrounds are step 1, negative z-index children are step 2)
- Code blocks use `z-index: auto` to break the stacking context, so `::after` paints below the opaque bg in the parent context
- Blockquotes use `::before` at `z-index: 1` to render the bar above the `::after` fill
- Tables suppress `::after` entirely and use padding+background instead (cells have opaque backgrounds that can't be painted behind)
- Outline radius = element radius + outline width (compounding) — use inset outline or padding approach to control exact rounding
