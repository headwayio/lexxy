import LexxyExtension from "./lexxy_extension"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $parseSerializedNode,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  INDENT_CONTENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND
} from "lexical"
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from "@lexical/list"
import { $createCodeNode, $isCodeNode } from "@lexical/code"
import { $isWrappedTableNode } from "../nodes/wrapped_table_node"
import { $createHeadingNode, $createQuoteNode, $isQuoteNode } from "@lexical/rich-text"
import { REMOVE_HIGHLIGHT_COMMAND, TOGGLE_HIGHLIGHT_COMMAND } from "./highlight_extension"
import { getCSSFromStyleObject, getStyleObjectFromCSS } from "@lexical/selection"
import { hasHighlightStyles } from "../helpers/format_helper"
import { getListItemNode } from "../helpers/lexical_helper"
import { BlockDragAndDrop } from "../editor/block_selection/drag_and_drop"
import { $isStructuralWrapper, BLOCK_FOCUSED_CLASS, BLOCK_SELECTED_CLASS, BLOCK_SELECTION_ACTIVE_CLASS, NESTED_LISTITEM_CLASS, getNodeKeyFromElement } from "../editor/block_helpers"
import { extractHighlightFromCSS, mergeHighlightIntoCSS, removeHighlightFromCSS } from "../editor/block_selection/highlight_css"
import { SelectionHistory } from "../editor/block_selection/selection_history"
import { WrappedOriginTracker } from "../editor/block_selection/wrapped_origin"
import { registerBulletMarkerColorSync } from "../editor/block_selection/bullet_color_sync"

// Block selection extension — gives the editor a second, block-level
// selection mode that sits above Lexical's range selection. The extension
// owns the mode machine, keyboard dispatch, block movement, and the glue
// to the block-actions menu and drag-and-drop subsystem.
//
// Helper modules live under src/editor/block_selection/:
//
//   drag_and_drop/         — mouse-driven block drag, ghost, drop targets
//   highlight_css.js       — pure CSS-string helpers for highlight colors
//   selection_history.js   — parallel undo/redo stack for block selection
//   wrapped_origin.js      — user-vs-movement wrapped-key origin tracking
//   bullet_color_sync.js   — node transform syncing <li> color to content
//
// This file keeps the cohesive state machine (selectedBlockKeys, anchor,
// focus, mode, and the ~100 methods that read/write them) in one class
// because their interdependencies can't be cleanly cut along file lines
// without widening the private surface. Navigate by the section markers
// below (// -- Foo --).
export class BlockSelectionExtension extends LexxyExtension {
  #mode = "edit"
  #selectedBlockKeys = new Set()
  #previousSelectedKeys = new Set()
  #anchorKey = null
  #focusKey = null
  #savedHighlightStyles = new Map() // nodeKey → original style string (before parent color was applied)
  #dragAndDrop = null
  #cleanupFns = []
  // Tracks list items wrapping a non-paragraph block. User-wrapped vs
  // movement-wrapped origin governs exit/unwrap semantics — see
  // WrappedOriginTracker. Lazy-initialized in connectedCallback since the
  // tracker needs the editor reference.
  #wrappedOrigins = null
  #blockActionsMenu = null
  #deleteNeighbors = null // { next, prev } keys after a delete, for arrow key navigation
  #selectionHistory = new SelectionHistory({
    snapshot: () => this.#snapshotSelectionState(),
    restore: (state) => this.#restoreSelectionState(state)
  })
  #interactionHandlersRegistered = false
  // Elements currently carrying transient selection-group decorations, tracked
  // so cleanup can iterate the set instead of querySelectorAll-ing the root
  // on every selection change (hot path during shift-extend on large docs).
  #selectionGroupElements = new Set()
  #parentHeightElements = new Set()
  #flushTopElements = new Set()
  #isolatedLeafElements = new Set()

  get enabled() {
    return this.editorElement.supportsRichText
  }

  get editor() {
    return this.editorElement.editor
  }

  get root() {
    return this.editor?.getRootElement()
  }

  get isBlockSelectMode() {
    return this.#mode === "block-select"
  }

  initializeEditor() {
    this.#wrappedOrigins = new WrappedOriginTracker(this.editor)

    // Node transforms must be active before initial content load so that
    // bullet marker colors sync when HTML with highlighted list items is set.
    this.#cleanupFns.push(registerBulletMarkerColorSync(this.editor))

    // All other handlers respond to user-dispatched commands (key presses,
    // clicks, toolbar actions). Deferring them to first interaction keeps
    // editor bootstrap fast — especially when many editors load at once.
    this.#deferInteractionHandlers()
  }

  dispose() {
    this.#exitBlockSelectMode()
    this.#dragAndDrop?.destroy()
    this.#blockActionsMenu?.remove()
    for (const fn of this.#cleanupFns) fn()
    this.#cleanupFns = []
  }

  #deferInteractionHandlers() {
    const activate = () => this.#registerInteractionHandlers()

    const activateWithDragAndDrop = () => {
      activate()
      if (!this.#dragAndDrop) {
        this.#dragAndDrop = new BlockDragAndDrop(this.editor, this.editorElement, this)
      }
    }

    // mouseenter fires before any mousedown/click, so handlers are ready
    // for the first click. focusin catches keyboard-first users (Tab to focus).
    const root = this.root
    root?.addEventListener("focusin", activate, { once: true })
    this.editorElement.addEventListener("mouseenter", activateWithDragAndDrop, { once: true })
    this.#cleanupFns.push(() => {
      root?.removeEventListener("focusin", activate)
      this.editorElement.removeEventListener("mouseenter", activateWithDragAndDrop)
    })
  }

  #registerInteractionHandlers() {
    if (this.#interactionHandlersRegistered) return
    this.#interactionHandlersRegistered = true

    this.#registerEscapeHandler()
    this.#registerClickHandler()
    this.#registerDecoratorClickInterceptor()
    this.#registerDirectKeydownHandler()
    this.#registerWrappedBlockIndentHandler()
    this.#registerEnterOnWrappedBlock()
    this.#registerHighlightClearOnEnter()
    this.#registerHighlightPropagation()
    this.#registerBlockSelectFormatHandler()
    this.#registerBulletOffsetSyncListener()
    this.#cleanupFns.push(...this.#selectionHistory.register(this.editor))
  }

  setShowHandles(show) {
    this.#dragAndDrop?.setShowHandles(show)
  }

  /** True when one or more blocks are selected (block-select mode). */
  get hasBlockSelection() {
    return this.#mode === "block-select"
  }

  // -- Mode transitions -------------------------------------------------------

  selectAll() {
    const allKeys = this.#getNavigableBlockKeys()
    if (allKeys.length === 0) return

    this.#mode = "block-select"
    this.root?.classList.add(BLOCK_SELECTION_ACTIVE_CLASS)
    this.#dragAndDrop?.hideHandles()
    this.editor.update(() => { $setSelection(null) })
    this.root?.focus({ preventScroll: true })
    this.#handleSelectAll()
  }

  enterBlockSelectMode(nodeKey, { keepHandles = false } = {}) {
    // Only bail if the user clicked the same primary block (anchor) again.
    // If the key is in the set as a child of the current anchor, allow
    // re-selection so clicking a child's handle narrows to just that child.
    if (this.#mode === "block-select" && this.#anchorKey === nodeKey) return

    this.#mode = "block-select"
    this.root?.classList.add(BLOCK_SELECTION_ACTIVE_CLASS)
    if (!keepHandles) {
      this.#dragAndDrop?.hideHandles()
    }

    // Clear Lexical selection but keep the root element focusable
    this.editor.update(() => {
      $setSelection(null)
    })

    // Ensure the editor root stays focused for keydown events
    this.root?.focus({ preventScroll: true })

    this.#selectBlock(nodeKey)
  }

  #exitBlockSelectMode() {
    if (this.#mode !== "block-select") return

    this.#mode = "edit"
    this.root?.classList.remove(BLOCK_SELECTION_ACTIVE_CLASS)
    this.#savedHighlightStyles.clear() // commit whatever colors are applied
    this.#clearAllSelections()
  }

  // -- Selection management ---------------------------------------------------

  #selectBlock(nodeKey, extend = false) {
    this.#deleteNeighbors = null
    // Cement inherited colors when selection changes — extending selection
    // (Shift+Arrow) or switching to a new block means the user has committed
    // to the current colors and doesn't want them restored on further moves.
    if (extend || (this.#selectedBlockKeys.size > 0 && !this.#selectedBlockKeys.has(nodeKey))) {
      this.#savedHighlightStyles.clear()
    }
    if (!extend) {
      this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
      this.#selectedBlockKeys.clear()
      this.#anchorKey = nodeKey
    }

    this.#selectedBlockKeys.add(nodeKey)
    this.#focusKey = nodeKey

    // Also select children (items in the structural wrapper after this node)
    if (!extend) {
      this.editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isListItemNode(node)) {
          this.#collectChildKeys(node, this.#selectedBlockKeys)
        }
      })
    }

    if (extend && this.#anchorKey) {
      // The range between anchor and focus covers exactly what should be
      // selected. No need to collect anchor's children separately — they're
      // included when they fall within the range (shift+down jumps to last
      // descendant) and excluded when they don't (shift+up contracting).
      this.#selectRange(this.#anchorKey, nodeKey)
    }

    this.#syncSelectionClasses()
  }

  // Collect keys of items nested under a list item (in its structural wrappers).
  // Walks ALL consecutive structural wrappers after the node — handles cases
  // where multiple wrappers exist (e.g., from list splitting or deep nesting).
  #collectChildKeys(listItemNode, keySet) {
    const childKeys = []

    // Block model: children live in a structural wrapper (next sibling LI)
    let next = listItemNode.getNextSibling()
    while (next && $isListItemNode(next) && $isStructuralWrapper(next)) {
      for (const child of next.getChildren()) {
        if ($isListNode(child)) {
          this.#collectListItemKeys(child, childKeys)
        }
      }
      next = next.getNextSibling()
    }

    // Standard Lexical model: nested ListNode as a direct child of the LI
    for (const child of listItemNode.getChildren()) {
      if ($isListNode(child)) {
        this.#collectListItemKeys(child, childKeys)
      }
    }

    for (const key of childKeys) {
      keySet.add(key)
    }
  }

  // True when pressing arrow in `direction` moves the focus AWAY from the
  // anchor (extending the selection), not back toward it (contracting).
  #isExtendingAway(direction) {
    if (!this.#anchorKey || !this.#focusKey) return true
    const allBlocks = this.#getDocumentOrderBlockKeys()
    const anchorIdx = allBlocks.indexOf(this.#anchorKey)
    const focusIdx = allBlocks.indexOf(this.#focusKey)
    if (anchorIdx === -1 || focusIdx === -1) return true
    // Focus is at or below anchor → pressing down extends away
    // Focus is at or above anchor → pressing up extends away
    if (direction === "down") return focusIdx >= anchorIdx
    return focusIdx <= anchorIdx
  }

  #selectRange(fromKey, toKey) {
    const allBlocks = this.#getNavigableBlockKeys()
    const fromIndex = allBlocks.indexOf(fromKey)
    const toIndex = allBlocks.indexOf(toKey)

    if (fromIndex === -1 || toIndex === -1) return

    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)

    this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
    this.#selectedBlockKeys.clear()

    for (let i = start; i <= end; i++) {
      this.#selectedBlockKeys.add(allBlocks[i])
    }

    this.#syncSelectionClasses()
  }

  #clearAllSelections() {
    this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
    this.#selectedBlockKeys.clear()
    this.#anchorKey = null
    this.#focusKey = null
    this.#syncSelectionClasses()
  }

  #syncSelectionClasses() {
    for (const key of this.#previousSelectedKeys) {
      if (!this.#selectedBlockKeys.has(key)) {
        const el = this.editor.getElementByKey(key)
        if (el) {
          el.classList.remove(BLOCK_SELECTED_CLASS, BLOCK_FOCUSED_CLASS,
            "lexxy-editor__block--select-first", "lexxy-editor__block--select-last")
        }
      }
    }

    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (el) {
        el.classList.add(BLOCK_SELECTED_CLASS)
        el.classList.toggle(BLOCK_FOCUSED_CLASS, key === this.#focusKey)
      }
    }

    // Remove focused from non-focus keys
    for (const key of this.#selectedBlockKeys) {
      if (key !== this.#focusKey) {
        const el = this.editor.getElementByKey(key)
        if (el) el.classList.remove(BLOCK_FOCUSED_CLASS)
      }
    }

    // Mark first/last in each contiguous group for border-radius styling.
    // Walk all selected elements in document order, detect group boundaries.
    this.#syncSelectionGroupClasses()

    this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
    this.#syncBulletOffsets()
    this.#syncParentSelectionHeight()
    this.#syncIsolatedLeafInsets()
  }

  #syncSelectionGroupClasses() {
    // Clear previous group classes from blocks AND structural wrappers
    for (const el of this.#selectionGroupElements) {
      el.classList.remove("lexxy-editor__block--select-first", "lexxy-editor__block--select-last", "lexxy-editor__block--select-mid")
    }
    this.#selectionGroupElements.clear()

    if (this.#selectedBlockKeys.size === 0) return

    // Mark selected LIs that are adjacent to other selected LIs as
    // lexxy-editor__block--select-mid. This enables contiguous group styling (flattened
    // edges between items with 2px gaps). Items in mixed lists (4px gaps)
    // keep full radius since the wider gaps don't visually merge.
    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (!el || el.tagName !== "LI") continue
      // Skip structural wrappers — they're handled separately
      if (el.classList.contains("lexxy-nested-listitem")) continue
      // Skip items in mixed lists — 4px gaps are too wide for flat-edge merging
      if (this.#isInMixedList(el)) continue

      // Check if this LI has an adjacent selected sibling (either direction).
      // Skip structural wrappers when looking for neighbors so the full run
      // of text bullets (including ones with nested wrapped content) forms a
      // single continuous highlight band. The parent-fill above a wrapper is
      // visually part of the same list-group — flat-connect with it, don't
      // treat it as its own card.
      let prev = el.previousElementSibling
      if (prev?.classList.contains("lexxy-nested-listitem")) {
        prev = prev.previousElementSibling
      }
      let next = el.nextElementSibling
      if (next?.classList.contains("lexxy-nested-listitem")) next = next.nextElementSibling

      const hasPrev = prev?.classList.contains(BLOCK_SELECTED_CLASS)
      const hasNext = next?.classList.contains(BLOCK_SELECTED_CLASS)

      if (hasPrev || hasNext) {
        el.classList.add("lexxy-editor__block--select-mid")
        this.#selectionGroupElements.add(el)
      }
    }

    // Now assign first/last: selected LIs with lexxy-editor__block--select-mid flatten
    // their touching edges. Items WITHOUT lexxy-editor__block--select-mid keep full radius.
    // Items with lexxy-editor__block--select-mid but no selected neighbor above = first,
    // items with lexxy-editor__block--select-mid but no selected neighbor below = last.
    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (!el || !el.classList.contains("lexxy-editor__block--select-mid")) continue

      const hasMidAbove = this.#hasSelectedNeighborAbove(el)
      const hasMidBelow = this.#hasSelectedNeighborBelow(el)

      if (!hasMidAbove) el.classList.add("lexxy-editor__block--select-first")
      if (!hasMidBelow) el.classList.add("lexxy-editor__block--select-last")
    }

    // Also mark structural wrappers at group boundaries. Iterate the tracked
    // set (the nested-listitems picked up during the mid-classification pass)
    // instead of querySelectorAll-ing the root.
    for (const wrapper of this.#selectionGroupElements) {
      if (wrapper.tagName !== "LI" || !wrapper.classList.contains("lexxy-nested-listitem")) continue
      if (!this.#hasSelectedNeighborBelow(wrapper)) {
        wrapper.classList.add("lexxy-editor__block--select-last")
      }
    }
  }

  #hasSelectedNeighborAbove(el) {
    let prev = el.previousElementSibling
    if (prev?.classList.contains("lexxy-nested-listitem")) {
      prev = prev.previousElementSibling
    }
    return prev?.classList.contains(BLOCK_SELECTED_CLASS) && prev.classList.contains("lexxy-editor__block--select-mid")
  }

  #hasSelectedNeighborBelow(el) {
    let next = el.nextElementSibling
    if (next?.classList.contains("lexxy-nested-listitem") && next.classList.contains("lexxy-editor__block--select-mid")) {
      return true
    }
    if (next?.classList.contains("lexxy-nested-listitem")) {
      next = next.nextElementSibling
    }
    return next?.classList.contains(BLOCK_SELECTED_CLASS) && next.classList.contains("lexxy-editor__block--select-mid")
  }

  // Check if a DOM LI element is inside a mixed list — one whose DIRECT
  // children include wrapped blocks as siblings to text bullets. Mixed
  // lists use 12px margins / 4px gaps which are too wide for flat-edge
  // contiguous group merging, so items keep full radius.
  //
  // Wrapped content inside a structural wrapper does NOT make the outer
  // list mixed: the wrapper is visually incorporated into its parent
  // bullet's highlight, and the outer text bullets still use the tight
  // 6px rhythm. This mirrors the CSS classification at
  // `:is(ul, ol):has(> li > h1, …)` which only matches direct wrapped
  // children.
  #isInMixedList(el) {
    const list = el.parentElement
    if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) return false
    return !!list.querySelector(
      ":scope > li > h1, :scope > li > h2, :scope > li > h3, :scope > li > h4, :scope > li > h5, :scope > li > h6, " +
      ":scope > li > blockquote, :scope > li > figure, :scope > li > .horizontal-divider, " +
      ":scope > li > pre, :scope > li > code[data-language], :scope > li > .lexxy-content__table-wrapper"
    )
  }

  // -- Block tree traversal ---------------------------------------------------

  #getDocumentOrderBlockKeys() {
    const keys = []
    this.editor.getEditorState().read(() => {
      const root = $getRoot()
      this.#collectBlockKeys(root, keys)
    })
    return keys
  }

  #collectBlockKeys(node, keys) {
    const children = node.getChildren()
    for (const child of children) {
      if ($isListNode(child)) {
        keys.push(child.getKey())
        this.#collectListItemKeys(child, keys)
      } else {
        keys.push(child.getKey())
      }
    }
  }

  #collectListItemKeys(listNode, keys) {
    const children = listNode.getChildren()
    for (const child of children) {
      if (!$isListItemNode(child)) continue

      if ($isStructuralWrapper(child)) {
        // Skip structural wrappers — recurse into their nested lists directly
        for (const grandchild of child.getChildren()) {
          if ($isListNode(grandchild)) {
            this.#collectListItemKeys(grandchild, keys)
          }
        }
      } else {
        // Content item — add its key and recurse into any nested lists
        // (standard Lexical model where children are inside the item).
        // Block-model structural wrappers are handled by the loop when
        // they're reached as the next child — no next-sibling check needed.
        keys.push(child.getKey())
        for (const grandchild of child.getChildren()) {
          if ($isListNode(grandchild)) {
            this.#collectListItemKeys(grandchild, keys)
          }
        }
      }
    }
  }

  // Navigation helpers take an optional precomputed navigable-keys list so
  // callers in a hot path (ArrowUp/Down handlers) can compute it once and
  // reuse across multiple calls. Falls back to computing on demand.
  #getNextBlockKey(currentKey, allKeys = this.#getNavigableBlockKeys()) {
    const index = allKeys.indexOf(currentKey)
    if (index === -1 || index >= allKeys.length - 1) return null
    return allKeys[index + 1]
  }

  #getPreviousBlockKey(currentKey, allKeys = this.#getNavigableBlockKeys()) {
    const index = allKeys.indexOf(currentKey)
    if (index <= 0) return null
    return allKeys[index - 1]
  }

  // Block keys suitable for arrow-key navigation — excludes ListNode
  // containers and hidden elements (provisional paragraphs) since they
  // aren't visually selectable.
  #getNavigableBlockKeys() {
    const allKeys = this.#getDocumentOrderBlockKeys()
    return allKeys.filter(key => {
      let isNavigable = true
      this.editor.getEditorState().read(() => {
        const node = $getNodeByKey(key)
        if ($isListNode(node)) isNavigable = false
        else {
          const el = this.editor.getElementByKey(key)
          if (el?.hidden || el?.classList.contains("hidden")) isNavigable = false
        }
      })
      return isNavigable
    })
  }

  // Walk up through nested lists to find the TOPMOST selected parent.
  // Returns that parent's key, or null if the item isn't inside a selected group.
  #getTopmostSelectedParentKey(childKey) {
    let topmostKey = null
    this.editor.getEditorState().read(() => {
      let node = $getNodeByKey(childKey)
      while (node && $isListItemNode(node)) {
        const listParent = node.getParent()
        if (!$isListNode(listParent)) break
        const wrapper = listParent.getParent()
        if (!wrapper || !$isListItemNode(wrapper) || !$isStructuralWrapper(wrapper)) break
        const parentItem = wrapper.getPreviousSibling()
        if (!parentItem || !$isListItemNode(parentItem) || !this.#selectedBlockKeys.has(parentItem.getKey())) break
        topmostKey = parentItem.getKey()
        node = parentItem // Keep walking up
      }
    })
    return topmostKey
  }

  // Returns the last descendant key of a parent list item, or null if the
  // item has no children. Used by shift+arrow to jump past an entire subtree.
  #getLastDescendantKey(nodeKey) {
    const childKeys = new Set()
    this.editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isListItemNode(node)) return

      this.#collectChildKeys(node, childKeys)

      // Fallback: if collectChildKeys found nothing but a structural
      // wrapper exists, walk it directly. This handles cases where the
      // wrapper detection paths diverge (e.g., non-structural item
      // between the content item and its wrapper).
      if (childKeys.size === 0) {
        const wrapper = this.#getOwnStructuralWrapper(node)
        if (wrapper) {
          for (const child of wrapper.getChildren()) {
            if ($isListNode(child)) {
              this.#collectListItemKeys(child, childKeys)
            }
          }
        }
      }
    })
    if (childKeys.size === 0) return null
    // Find the last child in document order
    const navKeys = this.#getNavigableBlockKeys()
    for (let i = navKeys.length - 1; i >= 0; i--) {
      if (childKeys.has(navKeys[i])) return navKeys[i]
    }
    return null
  }

  #getBlockKeyContainingCursor() {
    let blockKey = null
    this.editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      const anchorNode = selection.anchor.getNode()
      let current = anchorNode

      while (current) {
        const parent = current.getParent()
        if (!parent) break

        if (parent === $getRoot()) {
          blockKey = current.getKey()
          break
        }

        if ($isListItemNode(current)) {
          blockKey = current.getKey()
          break
        }

        current = parent
      }
    })
    return blockKey
  }

  // -- Keyboard handlers ------------------------------------------------------

  // Escape uses Lexical command since it fires reliably even with selection
  #registerEscapeHandler() {
    this.#cleanupFns.push(
      this.editor.registerCommand(KEY_ESCAPE_COMMAND, this.#handleEscape.bind(this), COMMAND_PRIORITY_HIGH)
    )
  }

  // Document-level keydown listener for block-select mode. Lexical's command
  // system doesn't dispatch key commands when selection is null, so we use a
  // direct listener. Registered on document (not the editor element) because
  // Lexical may blur the editor during reconciliation when selection is null,
  // which would prevent element-level listeners from firing.
  #registerDirectKeydownHandler() {
    const handler = this.#handleKeydown.bind(this)
    document.addEventListener("keydown", handler, true)
    this.#cleanupFns.push(() => {
      document.removeEventListener("keydown", handler, true)
    })
  }

  #isPromptOpen() {
    // lexxy-prompt tracks visibility via the popoverElement's
    // .lexxy-prompt-menu--visible class, not an [open] attribute. The popover
    // is appended to lexxy-editor (not inside lexxy-prompt), so query from
    // the editor element directly. Mirror the prompt's own `get open()` getter
    // so Escape and other keys don't enter block-select while a popover is
    // showing.
    return !!this.editorElement.querySelector(".lexxy-prompt-menu--visible")
  }

  #isBlockActionsMenuOpen() {
    return this.#blockActionsMenu && !this.#blockActionsMenu.hidden
  }

  #handleKeydown(event) {
    if (!this.editor) return

    // Listener is on document in capture phase (see #registerDirectKeydownHandler),
    // so it fires before a focused <dialog>'s native Esc handler. When a
    // preview modal (or any host-app dialog) is open, let its own Esc close
    // it — don't intercept keys here.
    if (document.querySelector("dialog[open]")) return

    // Esc clears a NodeSelection (e.g. clicked attachment showing blue outline)
    // even when the editor isn't focused. Lexical's KEY_ESCAPE_COMMAND only
    // fires when the contenteditable owns focus, but clicking a decorator node
    // typically moves focus to <body>, leaving the selection orphaned.
    if (event.key === "Escape" && !this.isBlockSelectMode) {
      // First Esc on a clicked decorator (node--selected) promotes it to
      // block-select mode so subsequent Esc / arrows / shortcuts behave
      // consistently with text-block selection. Match against the DOM class
      // because Lexical can drop the NodeSelection on focus loss while the
      // visual class persists. Lexical's KEY_ESCAPE_COMMAND alone wouldn't
      // fire here since focus is on <body>, not the contenteditable.
      const selectedNode = this.root?.querySelector(".node--selected")
      const figureKey = selectedNode?.dataset.lexicalNodeKey
      if (figureKey) {
        event.preventDefault()
        event.stopPropagation()
        // Clear visual + Lexical state immediately so the figure shows only
        // the block-selected highlight afterwards. Reset selection.js's
        // diff tracker too — otherwise its previouslySelectedKeys keeps the
        // stale key, and the next click on the same node looks "not new",
        // so the sync skips re-adding node--selected.
        selectedNode.classList.remove("node--selected")
        this.editorElement.selection?.previouslySelectedKeys?.clear()
        this.editor.update(() => {
          if ($isNodeSelection($getSelection())) $setSelection(null)
        })
        // If the figure is wrapped in a list, target the topmost list (ul/ol)
        // so block-select acts on the visible card frame the user sees,
        // not the bare figure inside it.
        let targetKey = figureKey
        this.editor.getEditorState().read(() => {
          let node = $getNodeByKey(figureKey)
          let topList = null
          while (node) {
            if ($isListNode(node)) topList = node
            node = node.getParent()
          }
          if (topList) targetKey = topList.getKey()
        })
        this.enterBlockSelectMode(targetKey)
        // Re-sync the bullet offset and drag handle for the freshly selected
        // block so they line up with the new highlight bounds (the target is
        // a list/figure that may not have been the previous hover target).
        this.#syncBulletOffsets()
        this.#dragAndDrop?.repositionHandle()
        return
      }
    }

    // ⌘⇧H applies last used color in both edit and block select modes
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "h" || event.key === "H")) {
      event.preventDefault()
      event.stopPropagation()
      this.#applyLastUsedColor()
      return
    }

    // ⌘⇧X strikethrough in both edit and block select modes
    // (Lexical doesn't register this shortcut — only the toolbar button works)
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "x" || event.key === "X")) {
      event.preventDefault()
      event.stopPropagation()
      if (this.isBlockSelectMode) {
        this.#applyInlineFormat("strikethrough")
      } else {
        this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
      }
      return
    }

    if (!this.isBlockSelectMode) return
    if (this.#isPromptOpen()) return
    if (this.#isBlockActionsMenuOpen()) return

    switch (event.key) {
      case "ArrowUp": {
        event.preventDefault()
        event.stopPropagation()
        if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
          this.#moveSelectedBlocks("up")
        } else if (!this.#focusKey && this.#deleteNeighbors) {
          // After a delete with no selection, pick the block above the deletion
          const key = this.#deleteNeighbors.prev || this.#deleteNeighbors.next
          if (key) this.#selectBlock(key)
          this.#deleteNeighbors = null
        } else {
          const navKeys = this.#getNavigableBlockKeys()
          let prevKey = this.#getPreviousBlockKey(this.#focusKey, navKeys)
          // When contracting upward through a parent+children group that
          // was selected as a unit (via shift+down), skip the entire group
          // so it deselects atomically — not one child at a time.
          if (prevKey && event.shiftKey && !this.#isExtendingAway("up")) {
            // Check if prevKey belongs to a parent group that's also selected
            const parentOfPrev = this.#getTopmostSelectedParentKey(prevKey)
            if (parentOfPrev) {
              // Jump to the item before the parent to deselect the whole group
              const beforeParent = this.#getPreviousBlockKey(parentOfPrev, navKeys)
              if (beforeParent) prevKey = beforeParent
            }
          }
          if (prevKey) {
            this.#selectBlock(prevKey, event.shiftKey)
            this.#scrollBlockIntoView(prevKey)
          }
        }
        break
      }

      case "ArrowDown": {
        event.preventDefault()
        event.stopPropagation()
        if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
          this.#moveSelectedBlocks("down")
        } else if (!this.#focusKey && this.#deleteNeighbors) {
          // After a delete with no selection, pick the block below the deletion
          const key = this.#deleteNeighbors.next || this.#deleteNeighbors.prev
          if (key) this.#selectBlock(key)
          this.#deleteNeighbors = null
        } else {
          const navKeys = this.#getNavigableBlockKeys()
          let nextKey = this.#getNextBlockKey(this.#focusKey, navKeys)
          // When extending selection downward (Shift+Arrow):
          // 1. Skip past already-selected items (e.g., children of a parent
          //    that was selected non-shift).
          // 2. If landing on a parent, jump focus to its last descendant so
          //    the entire subtree is included in the range selection.
          // When contracting (moving back toward anchor), deselect one at a time.
          if (nextKey && event.shiftKey && this.#isExtendingAway("down")) {
            // Skip past already-selected items to find the first unselected one
            while (nextKey && this.#selectedBlockKeys.has(nextKey)) {
              const after = this.#getNextBlockKey(nextKey, navKeys)
              if (!after) break
              nextKey = after
            }
            // If we ended on a still-selected key (hit end of list), there's
            // nowhere to extend — skip the descendant jump entirely
            if (!this.#selectedBlockKeys.has(nextKey)) {
              const lastDesc = this.#getLastDescendantKey(nextKey)
              if (lastDesc) nextKey = lastDesc
            }
          }
          if (nextKey) {
            this.#selectBlock(nextKey, event.shiftKey)
            this.#scrollBlockIntoView(nextKey)
          }
        }
        break
      }

      case "Enter":
        event.preventDefault()
        event.stopPropagation()
        this.#handleEnter()
        break

      case "Backspace":
      case "Delete":
        event.preventDefault()
        event.stopPropagation()
        this.#handleDelete()
        break

      case "Tab":
        event.preventDefault()
        event.stopPropagation()
        this.#handleIndentOutdent(event.shiftKey)
        break

      case "/":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          event.stopPropagation()
          this.#openBlockActionsMenu()
        }
        break

      case "d":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          event.stopPropagation()
          this.#handleDuplicate()
        }
        break

      case "a":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          event.stopPropagation()
          this.#handleSelectAll()
        }
        break

      case "b":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          event.stopPropagation()
          this.#applyInlineFormat("bold")
        }
        break

      case "i":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          event.stopPropagation()
          this.#applyInlineFormat("italic")
        }
        break

      case "u":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          event.stopPropagation()
          this.#applyInlineFormat("underline")
        }
        break

      // x/X (strikethrough) handled before the block-select guard above

      case "k":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          event.stopPropagation()
        }
        break

    }
  }

  #handleEscape(event) {
    if (this.#isPromptOpen()) return false

    if (this.isBlockSelectMode) {
      // Block-select → exit and blur the editor. The next Esc will bubble
      // to the parent (slide-over/modal close) since the editor isn't focused.
      this.#exitBlockSelectMode()
      this.editor.update(() => { $setSelection(null) })
      this.root?.blur()
      return true
    }

    // NodeSelection (e.g. clicked attachment shows blue outline) → clear it
    // before falling through to block-select. Without this, Esc on a clicked
    // attachment would jump straight to block-select, which feels surprising.
    let hasNodeSelection = false
    this.editor.getEditorState().read(() => {
      hasNodeSelection = $isNodeSelection($getSelection())
    })
    if (hasNodeSelection) {
      this.editor.update(() => { $setSelection(null) })
      this.root?.blur()
      return true
    }

    // Edit mode → enter block-select on the current block
    const blockKey = this.#getBlockKeyContainingCursor()
    if (blockKey) {
      this.enterBlockSelectMode(blockKey)
      return true
    }

    return false
  }

  #handleEnter() {
    const targetKey = this.#focusKey
    this.#exitBlockSelectMode()

    if (targetKey) {
      this.editor.update(() => {
        const node = $getNodeByKey(targetKey)
        if (node) {
          if (node.selectEnd) {
            node.selectEnd()
          } else if (node.select) {
            node.select()
          }
        }
      })
    }

    this.editor.focus()
  }

  #handleDelete() {
    // Remember position in the document so arrow keys know where to start.
    // Find the neighbors BEFORE deleting.
    const allKeys = this.#getDocumentOrderBlockKeys()
    const keyIdx = new Map(allKeys.map((k, i) => [ k, i ]))
    const selectedSet = new Set(this.#selectedBlockKeys)
    let nextKey = null
    let prevKey = null

    let lastSelectedIdx = -1
    let firstSelectedIdx = allKeys.length
    for (const key of selectedSet) {
      const idx = keyIdx.get(key)
      if (idx == null) continue
      if (idx > lastSelectedIdx) lastSelectedIdx = idx
      if (idx < firstSelectedIdx) firstSelectedIdx = idx
    }
    for (let i = lastSelectedIdx + 1; i < allKeys.length; i++) {
      if (!selectedSet.has(allKeys[i])) { nextKey = allKeys[i]; break }
    }
    for (let i = firstSelectedIdx - 1; i >= 0; i--) {
      if (!selectedSet.has(allKeys[i])) { prevKey = allKeys[i]; break }
    }

    this.editor.update(() => {
      for (const key of this.#selectedBlockKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        const root = $getRoot()
        if (root.getChildrenSize() <= 1 && node.getParent() === root) continue

        // For list items, walk up to find the highest ancestor that would
        // become empty if we delete this node. This cleanly removes the
        // entire nesting chain (li → ul → structural-wrapper li → ul → ...)
        // without leaving phantom empty items from Lexical's normalizer.
        const target = this.#findHighestRemovableAncestor(node, root)
        target.remove()
      }
    })

    // Stay in block select mode with NO selection — the user picks
    // the direction with arrow keys (like Notion). Store the position
    // so Up/Down know where to start from.
    this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
    this.#selectedBlockKeys.clear()
    this.#anchorKey = null
    this.#focusKey = null
    this.#deleteNeighbors = { next: nextKey, prev: prevKey }
    this.#syncSelectionClasses()
  }

  #handleSelectAll() {
    // Select all visible blocks. For lists, select the individual LIs
    // (not the invisible UL/OL container) so each item gets its own
    // selection highlight.
    const allKeys = this.#getNavigableBlockKeys()

    if (allKeys.length > 0) {
      this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
      this.#selectedBlockKeys = new Set(allKeys)
      this.#anchorKey = allKeys[0]
      this.#focusKey = allKeys[allKeys.length - 1]
      this.#syncSelectionClasses()
    }
  }

  #openBlockActionsMenu() {
    if (!this.#focusKey) return

    const focusedEl = this.editor.getElementByKey(this.#focusKey)
    if (!focusedEl) return

    // Lazy-create the menu element
    if (!this.#blockActionsMenu) {
      this.#blockActionsMenu = document.createElement("lexxy-block-actions")
      this.#blockActionsMenu.hidden = true
      this.editorElement.appendChild(this.#blockActionsMenu)
    }

    // Determine per-block-type restrictions for the turn-into menu.
    // Each non-text block type has a distinct set of allowed conversions.
    let blockRestriction = null // null = no restrictions (regular text block)
    let canUnwrapFromQuote = false
    let unwrapListType = null
    this.editor.getEditorState().read(() => {
      let node = $getNodeByKey(this.#focusKey)
      if (!node) return
      // Drill through any container that wraps a single non-text block
      // (list item with a wrapped heading/quote/code/decorator, or
      // blockquote wrapping a decorator/code). The restriction applies to
      // the *content* being wrapped — not the container — so the user sees
      // the same options regardless of how many layers currently surround
      // the content.
      //
      // While drilling, note whether we passed through a QuoteNode or a
      // ListItemNode. If the final content isn't text, we offer explicit
      // "Remove Quote" / "Remove Bullet|Numbered" actions — these wrappers
      // have no Turn into Text path out for decorators (HRs, attachments),
      // so users need a discoverable way to extract just the wrapper.
      let sawQuote = false
      let sawListItem = null // the ListItemNode we last saw
      while ($isListItemNode(node) || $isQuoteNode(node)) {
        if ($isQuoteNode(node)) sawQuote = true
        if ($isListItemNode(node)) sawListItem = node
        const child = node.getChildren().find(c =>
          ($isElementNode(c) || $isDecoratorNode(c))
          && !$isListNode(c) && !$isParagraphNode(c)
        )
        if (!child) break
        node = child
      }
      // Wrapped versions of a content type get the same turn-into options as
      // their unwrapped counterparts — the restriction reflects what's
      // meaningful for the content (code loses formatting if converted to
      // list/quote, tables lose cells, decorators have no text to convert).
      if ($isCodeNode(node)) {
        blockRestriction = "code"
      } else if ($isWrappedTableNode(node)) {
        blockRestriction = "table"
      } else if ($isDecoratorNode(node)) {
        blockRestriction = "decorator"
      }

      // Contextual actions for wrappers around non-text content.
      if (blockRestriction !== null) {
        canUnwrapFromQuote = sawQuote
        if (sawListItem) {
          const list = sawListItem.getParent()
          if ($isListNode(list)) unwrapListType = list.getListType()
        }
      }
    })

    this.#blockActionsMenu.show({
      anchorElement: focusedEl,
      editorElement: this.editorElement,
      onAction: (action) => this.#handleBlockAction(action),
      onClose: () => this.root?.focus(),
      blockRestriction,
      canUnwrapFromQuote,
      unwrapListType
    })

    this.#blockActionsMenu.focus()
  }

  #applyLastUsedColor() {
    try {
      const stored = localStorage.getItem("lexxy-last-color")
      if (!stored) return
      const last = JSON.parse(stored)
      if (!last?.style || !last?.value) return

      if (this.isBlockSelectMode) {
        this.#handleBlockAction({ type: "color", style: last.style, value: last.value })
      } else {
        // In edit mode, apply directly to the current text selection
        this.editor.dispatchCommand(TOGGLE_HIGHLIGHT_COMMAND, { [last.style]: last.value })
      }
    } catch { /* localStorage may be unavailable */ }
  }

  #handleBlockAction(action) {
    switch (action.type) {
      case "turn-into":
        this.#convertBlockType(action.command)
        break

      case "color":
        this.#applyColorToSelectedBlocks(action.style, action.value)
        break

      case "remove-color":
        this.#applyColorToSelectedBlocks(null, null)
        break

      case "remove-quote":
        this.#removeQuoteWrapper()
        break

      case "remove-list":
        this.#removeListWrapper()
        break

      case "duplicate":
        this.#handleDuplicate()
        break

      case "delete":
        this.#handleDelete()
        break
    }
  }

  // Apply color to ALL text nodes in all selected blocks (and their children).
  // Skips code blocks. Pass null values to remove color.
  #applyColorToSelectedBlocks(styleProp, value) {
    const scrollY = window.scrollY

    this.editor.update(() => {
      const keys = [ ...this.#selectedBlockKeys ]
      for (const key of keys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        const textNodes = this.#getAllTextNodesForItem(node)

        for (const t of textNodes) {
          const existing = { ...getStyleObjectFromCSS(t.getStyle() || "") }
          if (value) {
            existing[styleProp] = value
          } else {
            delete existing.color
            delete existing["background-color"]
          }
          t.setStyle(getCSSFromStyleObject(existing))
        }
      }
    }, { tag: "history-push" })

    queueMicrotask(() => window.scrollTo(window.scrollX, scrollY))

    requestAnimationFrame(() => this.#syncSelectionClasses())
  }

  #applyInlineFormat(format) {
    this.#withTemporarySelection(() => {
      this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    })
  }

  // Create a temporary RangeSelection over selected blocks, run the callback,
  // then restore null selection for block select mode.
  #withTemporarySelection(callback) {
    this.editor.update(() => {
      const keys = [ ...this.#selectedBlockKeys ]
      if (keys.length === 0) return

      const firstNode = $getNodeByKey(keys[0])
      const lastNode = $getNodeByKey(keys[keys.length - 1])
      if (!firstNode) return

      // Select from start of first block to end of last block.
      // We must avoid calling lastNode.selectEnd() because it creates a
      // new RangeSelection (replacing the one from selectStart). Instead,
      // set the focus point directly on the existing selection.
      firstNode.selectStart()
      const selection = $getSelection()
      if ($isRangeSelection(selection) && lastNode) {
        const lastDescendant = lastNode.getLastDescendant()
        if (lastDescendant) {
          const endOffset = $isElementNode(lastDescendant)
            ? lastDescendant.getChildrenSize()
            : lastDescendant.getTextContentSize()
          selection.focus.set(
            lastDescendant.getKey(),
            endOffset,
            $isElementNode(lastDescendant) ? "element" : "text"
          )
        } else {
          selection.focus.set(lastNode.getKey(), lastNode.getChildrenSize(), "element")
        }
      }

      callback()

      $setSelection(null)
    }, { tag: HISTORY_MERGE_TAG })

    this.#syncAndRefocus()
  }

  // Convert selected blocks to a different block type. For list items,
  // this extracts the item from its list (splitting the list around it)
  // and inserts the new block type at that position. For list-to-list
  // conversions, it just changes the list item type.
  #convertBlockType(command) {
    const scrollY = window.scrollY
    const isListCommand = command === "insertUnorderedList" || command === "insertOrderedList"
    const listType = command === "insertUnorderedList" ? "bullet" : "number"

    this.editor.update(() => {
      const newSelectedKeys = new Set()
      const replacedKeys = new Set()

      for (const key of this.#selectedBlockKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        // Tables preserve cell data only when wrapped (list or quote). Skip
        // text-conversion commands that would replace the table with a
        // non-table node; allow list/quote commands through so the table
        // gets wrapped in a list item or blockquote. The menu already
        // restricts single-block selections to Text + Color only, so this
        // guard primarily protects tables dragged into multi-block Turn
        // intos alongside other blocks.
        const isTable = $isWrappedTableNode(node)
          || ($isListItemNode(node) && node.getChildren().some($isWrappedTableNode))
        if (isTable && !isListCommand && command !== "insertQuoteBlock") {
          newSelectedKeys.add(key)
          continue
        }

        if ($isListItemNode(node)) {
          if (isListCommand) {
            // List-to-list: change the item's list type AND unwrap if wrapped
            if (node.setListItemType) node.setListItemType(listType)
            const wrappedChild = node.getChildren().find(c =>
              $isElementNode(c) && !$isListNode(c) && !$isParagraphNode(c)
            )
            if (wrappedChild) {
              for (const child of [ ...wrappedChild.getChildren() ]) {
                node.append(child)
              }
              wrappedChild.remove()
              this.#wrappedOrigins.untrack(node.getKey())
            }
            newSelectedKeys.add(node.getKey())
          } else if (command === "setFormatParagraph") {
            // Wrapped → paragraph: unwrap back to regular list item content
            const children = node.getChildren()
            const wrappedChild = children.find(c =>
              $isElementNode(c) && !$isListNode(c) && !$isParagraphNode(c)
            )
            if (wrappedChild) {
              // Move wrapped content's children into the list item directly
              for (const child of [ ...wrappedChild.getChildren() ]) {
                node.append(child)
              }
              wrappedChild.remove()
              this.#wrappedOrigins.untrack(node.getKey())
            }
            newSelectedKeys.add(node.getKey())
          } else {
            // List item → wrapped block: convert inline content to a wrapped
            // block element (e.g., heading, quote) inside the list item.
            this.#wrapListItemContent(node, command)
            newSelectedKeys.add(node.getKey())
          }
        } else if ($isDecoratorNode(node) || $isWrappedTableNode(node)) {
          // Non-text blocks (attachment, table) — Lexical's command
          // handlers operate on RangeSelection of text content and silently
          // no-op on a NodeSelection. Wrap the node manually so list/quote
          // commands work. Heading/paragraph/code conversions don't apply.
          // (Code blocks are excluded here — they go through the standard
          // dispatch path below since they DO have selectable text content.)
          if (isListCommand) {
            // Idempotent: if already inside a list item of the same type,
            // don't double-wrap. Just surface the existing list item as the
            // selection target.
            const parent = node.getParent()
            if ($isListItemNode(parent) && $isListNode(parent.getParent()) && parent.getParent().getListType() === listType) {
              newSelectedKeys.add(parent.getKey())
              replacedKeys.add(key)
            } else {
              const list = $createListNode(listType)
              const listItem = $createListItemNode()
              list.append(listItem)
              node.replace(list)
              listItem.append(node)
              this.#wrappedOrigins.trackUser(listItem.getKey())
              newSelectedKeys.add(listItem.getKey())
              replacedKeys.add(key)
            }
          } else if (command === "insertQuoteBlock") {
            // Idempotent: if already inside a blockquote, don't nest another.
            const parent = node.getParent()
            if ($isQuoteNode(parent)) {
              newSelectedKeys.add(parent.getKey())
              replacedKeys.add(key)
            } else {
              const quote = $createQuoteNode()
              node.replace(quote)
              quote.append(node)
              newSelectedKeys.add(quote.getKey())
              replacedKeys.add(key)
            }
          } else {
            // Heading / paragraph / code — not meaningful for decorators.
            newSelectedKeys.add(node.getKey())
          }
        } else if (isListCommand) {
          // Non-list block → list: wrap in a new ListNode + ListItemNode.
          //
          // For paragraphs, the text nodes move directly into the list item
          // (paragraphs don't survive as meaningful wrappers — `<li><p>`
          // collapses to a plain bullet visually).
          //
          // For everything else (heading, blockquote, code, table, decorator
          // handled in the earlier branch), the block itself becomes the
          // wrapped child of the list item. This preserves the block's type
          // AND — because wrapped list items can carry nested children via
          // structural wrappers — makes the block a valid nest target.
          // Clicking Turn into Bullet a second time unwraps the block
          // (existing $isListItemNode branch handles that).
          //
          // Adjacent same-type lists merge during reconciliation, so
          // consecutive converted items end up in one list.
          const list = $createListNode(listType)
          const listItem = $createListItemNode()
          list.append(listItem)
          if ($isParagraphNode(node)) {
            for (const child of [ ...node.getChildren() ]) {
              listItem.append(child)
            }
            node.replace(list)
          } else {
            node.replace(list)
            listItem.append(node)
            this.#wrappedOrigins.trackUser(listItem.getKey())
          }
          newSelectedKeys.add(listItem.getKey())
          replacedKeys.add(key)
        } else if (command === "insertQuoteBlock" && $isQuoteNode(node)
                   && node.getChildren().every(c =>
                     ($isElementNode(c) || $isDecoratorNode(c))
                     && !$isListNode(c) && !$isParagraphNode(c)
                   )) {
          // Toggle: Turn into Quote on a blockquote wrapping non-text
          // content (decorator, HR, code, heading) removes the wrapper.
          // Promotes each wrapped block to the quote's former position in
          // order. Text-only blockquotes fall through to the replace path
          // below since their TextNode children can't live at root without
          // a paragraph wrapper.
          const children = [ ...node.getChildren() ]
          const first = children[0]
          node.replace(first)
          let ref = first
          for (let i = 1; i < children.length; i++) {
            ref.insertAfter(children[i])
            ref = children[i]
          }
          newSelectedKeys.add(first.getKey())
          replacedKeys.add(key)
        } else {
          // Non-list block → non-list block (paragraph, heading, quote,
          // code): replace the node with a new block of the target type,
          // moving children across. Doing this directly (instead of via
          // editor.dispatchCommand → $setBlocksType inside our outer
          // editor.update) keeps each iteration independent — Lexical's
          // command pipeline running synchronously inside our update can
          // produce surprising no-ops when chained per-iteration, which made
          // multi-block turn-into only convert the first item.
          const newBlock = this.#createBlockForCommand(command)
          if (!newBlock) {
            newSelectedKeys.add(node.getKey())
            continue
          }
          for (const child of [ ...node.getChildren?.() || [] ]) {
            newBlock.append(child)
          }
          node.replace(newBlock)
          newSelectedKeys.add(newBlock.getKey())
          replacedKeys.add(key)
        }
      }

      // Merge keys from #extractListItemAsBlock with new keys.
      // Only include nodes still attached to the document tree —
      // replaced nodes (e.g., paragraph → heading) linger in the
      // node map as orphans during the update callback. Skip keys we
      // explicitly replaced (e.g., decorator → list item wrapper) so the
      // merge doesn't resurrect them alongside their new wrapper.
      for (const key of this.#selectedBlockKeys) {
        if (replacedKeys.has(key)) continue
        if (!newSelectedKeys.has(key)) {
          const node = $getNodeByKey(key)
          if (node && node.getParent() !== null) newSelectedKeys.add(key)
        }
      }

      // Update selection to the converted blocks
      this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
      this.#selectedBlockKeys = newSelectedKeys
      if (newSelectedKeys.size > 0) {
        const keys = [ ...newSelectedKeys ]
        this.#anchorKey = keys[0]
        this.#focusKey = keys[keys.length - 1]
      }

      // Ensure Lexical selection is null for block select mode
      $setSelection(null)
    }, { tag: HISTORY_PUSH_TAG })

    this.#syncAndRefocus()
    queueMicrotask(() => window.scrollTo(window.scrollX, scrollY))
  }

  // Convert a list item's inline content into a wrapped block element
  // (heading, quote, etc.) that stays inside the list. If the item already
  // contains a wrapped block, change its type instead of double-wrapping.
  #wrapListItemContent(node, command) {
    const newBlock = this.#createBlockForCommand(command)
    if (!newBlock) return

    const children = node.getChildren()

    // Already wrapped? Just swap the wrapped element type.
    const existingWrapped = children.find(c =>
      $isElementNode(c) && !$isListNode(c) && !$isParagraphNode(c)
    )
    if (existingWrapped) {
      // Move existing wrapped content's children into the new block
      for (const child of [ ...existingWrapped.getChildren() ]) {
        newBlock.append(child)
      }
      existingWrapped.replace(newBlock)
    } else {
      // Regular list item with inline content → wrap in block element
      for (const child of [ ...children ]) {
        if ($isListNode(child)) continue // skip nested lists
        newBlock.append(child)
      }
      // Insert the block as the first child (before any nested lists)
      const firstChild = node.getFirstChild()
      if (firstChild) {
        firstChild.insertBefore(newBlock)
      } else {
        node.append(newBlock)
      }
    }

    // Track as a user-wrapped block (persists through arrow movement,
    // only outdented via Shift+Tab).
    this.#wrappedOrigins.trackUser(node.getKey())
  }

  // Extract a list item from its parent list, convert it to the target
  // block type, and split the list around it. Items after the extracted
  // item (including nested children) form a new list below the new block.
  #createBlockForCommand(command) {
    switch (command) {
      case "setFormatParagraph": return $createParagraphNode()
      case "setFormatHeadingXLarge": return $createHeadingNode("h1")
      case "setFormatHeadingLarge": return $createHeadingNode("h2")
      case "setFormatHeadingMedium": return $createHeadingNode("h3")
      case "setFormatHeadingSmall": return $createHeadingNode("h4")
      case "insertQuoteBlock": return $createQuoteNode()
      case "insertCodeBlock": return $createCodeNode("plain")
      default: return null
    }
  }

  #handleDuplicate() {
    this.editor.update(() => {
      const allKeys = this.#getDocumentOrderBlockKeys()
      const keyIdx = new Map(allKeys.map((k, i) => [ k, i ]))
      const rootKeys = this.#filterToRootKeys([ ...this.#selectedBlockKeys ])
      rootKeys.sort((a, b) => keyIdx.get(a) - keyIdx.get(b))

      const newKeys = []
      // Insert clones after the LAST root key (+ its wrapper) so the group stays together
      const lastRoot = $getNodeByKey(rootKeys[rootKeys.length - 1])
      let insertAfterNode = lastRoot
      // Skip past structural wrapper if present
      const lastWrapper = insertAfterNode?.getNextSibling()
      if (lastWrapper && $isListItemNode(lastWrapper) && $isStructuralWrapper(lastWrapper)) {
        insertAfterNode = lastWrapper
      }

      for (const key of rootKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        // Clone the node (and its structural wrapper children if any)
        const clone = $parseSerializedNode(this.#exportNodeWithChildren(node))
        const ownWrapper = this.#getOwnStructuralWrapper(node)
        let wrapperClone = null
        if (ownWrapper) {
          wrapperClone = $parseSerializedNode(this.#exportNodeWithChildren(ownWrapper))
        }

        if (insertAfterNode) {
          try {
            insertAfterNode.insertAfter(clone)
            if (wrapperClone) clone.insertAfter(wrapperClone)
            insertAfterNode = wrapperClone || clone
          } catch (_) {
            // Fallback: insert at root level
            const root = $getRoot()
            root.append(clone)
            insertAfterNode = clone
          }
        }
        newKeys.push(clone.getKey())
        // Also collect cloned children keys for selection
        if (wrapperClone) {
          function collectKeys(n) {
            if ($isListItemNode(n) && !$isStructuralWrapper(n)) newKeys.push(n.getKey())
            if ($isElementNode(n)) n.getChildren().forEach(collectKeys)
          }
          collectKeys(wrapperClone)
        }
      }

      // Select the duplicated blocks
      if (newKeys.length > 0) {
        this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
        this.#selectedBlockKeys = new Set(newKeys)
        this.#anchorKey = newKeys[0]
        this.#focusKey = newKeys[newKeys.length - 1]
      }
    }, { tag: HISTORY_MERGE_TAG })

    this.#syncAndRefocus()
  }

  // Recursively serialize a node and its children. Lexical's exportJSON()
  // only serializes the node itself (children: []), so we must walk the
  // tree to produce a JSON structure that $parseSerializedNode can recreate.
  #exportNodeWithChildren(node) {
    const json = node.exportJSON()
    if ($isElementNode(node)) {
      json.children = node.getChildren().map(child => this.#exportNodeWithChildren(child))
    }
    return json
  }

  // Sync selection classes after a block action. The document-level keydown
  // listener doesn't depend on focus, so no re-focus is needed.
  #syncAndRefocus() {
    requestAnimationFrame(() => {
      this.#syncSelectionClasses()
      requestAnimationFrame(() => {
        this.#dragAndDrop?.repositionHandle()
        this.#syncBulletOffsets()
      })
    })
  }

  #handleIndentOutdent(outdent) {
    this.#selectionHistory.push()
    this.editor.update(() => {
      // Filter to root keys only (parents, not their auto-selected children)
      const rootKeys = this.#filterToRootKeys([ ...this.#selectedBlockKeys ])

      // Shift+Tab on a blockquote that wraps a single non-text block
      // (decorator, HR, attachment, code, table) unwraps the content out of
      // the blockquote. No analogous "indent" shape exists for quotes, so
      // this only runs on outdent.
      if (outdent) {
        for (const key of rootKeys) {
          const node = $getNodeByKey(key)
          if (!node || !$isQuoteNode(node)) continue
          this.#unwrapQuoteIfWrappingNonText(node)
        }
      }

      const listItemKeys = rootKeys.filter(key => {
        const node = $getNodeByKey(key)
        return node && $isListItemNode(node)
      })
      if (listItemKeys.length === 0) return

      // Process each item: use wrapped-block indent for non-text blocks,
      // Lexical's standard indent for regular list items.
      // Wrapped items that can't outdent further are collected for group exit
      // (same code path as Cmd+Shift+Up).
      const exitGroup = []

      for (const key of listItemKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        const children = node.getChildren()
        const isWrapped = children.some(c =>
          ($isElementNode(c) || $isDecoratorNode(c))
          && !$isListNode(c) && !$isParagraphNode(c)
        )
        const hasChildren = !!this.#getOwnStructuralWrapper(node)

        if (isWrapped || hasChildren) {
          // Wrapped blocks or items with children — use our indent/outdent
          // which carries the structural wrapper with the node
          if (outdent) {
            const didOutdent = this.#outdentWrappedBlock(node)
            if (!didOutdent && isWrapped) {
              // At root-level list — collect for in-place extraction
              const wrapper = this.#getOwnStructuralWrapper(node)
              exitGroup.push({ node, wrapper })
            } else if (!didOutdent && hasChildren) {
              // Can't outdent further but has children — flatten one level.
              // Promotes all children from the structural wrapper to be
              // siblings of the parent, one nesting level at a time.
              this.#flattenChildrenOneLevel(node)
            }
          } else {
            this.#indentWrappedBlock(node)
          }
        } else {
          // Simple list item — use Lexical's built-in indent/outdent
          node.selectStart()
          this.editor.dispatchCommand(
            outdent ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND
          )
          // After indent, inherit parent highlight color. Re-fetch the node
          // since indent may have changed internal state.
          if (!outdent) {
            const movedNode = $getNodeByKey(key)
            if (movedNode && $isListItemNode(movedNode)) {
              this.#inheritParentHighlight(movedNode)
            }
          }
        }
      }

      // Extract wrapped items in place, splitting lists as needed.
      // Regular bullets stay in list segments that form naturally
      // from the splits, preserving document order.
      if (exitGroup.length > 0) {
        this.#extractWrappedItemsInPlace(exitGroup)
      }

      $setSelection(null)
    })

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // After outdent, the block may have adopted new children (siblings that
        // became nested under it). Re-collect children for all selected root keys
        // so the selection includes the full subtree.
        if (outdent) {
          this.editor.getEditorState().read(() => {
            const rootKeys = this.#filterToRootKeys([ ...this.#selectedBlockKeys ])
            for (const key of rootKeys) {
              const node = $getNodeByKey(key)
              if (node && $isListItemNode(node)) {
                this.#collectChildKeys(node, this.#selectedBlockKeys)
              }
            }
          })
        }

        this.#syncSelectionClasses()
        this.#dragAndDrop?.repositionHandle()
        this.#syncBulletOffsets()
      })
    })
  }

  // -- Block movement ---------------------------------------------------------
  //
  // Movement follows a depth-first traversal of the tree. Each "move"
  // shifts the node one step in the DFS order:
  //
  // Move UP:
  //   1. Has previous sibling? → Nest under it as its last child
  //   2. No previous sibling? → Promote: become sibling before parent
  //
  // Move DOWN:
  //   1. Has next sibling? → Nest under it as its first child
  //   2. No next sibling? → Promote: become sibling after parent
  //
  // This naturally creates the alternating nest/promote pattern:
  //   nest under prev → promote above prev → nest under prev-prev → ...

  #moveSelectedBlocks(direction) {
    const selectedKeys = [ ...this.#selectedBlockKeys ]
    if (selectedKeys.length === 0) return

    // Suppress hover-driven handle positioning during the move to prevent
    // stale layout measurements from racing with our double-rAF sync.
    this.#dragAndDrop?.suppressHover()

    // Use filterToRootKeys so the group moves as a unit (children travel
    // with their root via structural wrappers). After the move, flatten
    // selected children to be siblings of their root key.
    const rootKeys = this.#filterToRootKeys(selectedKeys)
    const allKeys = this.#getDocumentOrderBlockKeys()
    const keyIdx = new Map(allKeys.map((k, i) => [ k, i ]))
    rootKeys.sort((a, b) => keyIdx.get(a) - keyIdx.get(b))

    this.#selectionHistory.push()
    this.editor.update(() => {
      if (rootKeys.length === 1) {
        // Single root key: use existing single-item logic
        this.#moveSingleBlock(rootKeys[0], direction)
      } else {
        // Multiple items: move as an atomic group
        this.#moveGroupAtomically(rootKeys, direction)
      }

      // Re-sync wrapped keys with current selection after all moves.
      // Lexical's copy-on-write may have changed keys during the update.
      try { this.#wrappedOrigins.resync(this.#selectedBlockKeys) } catch (_) { /* nodes may have been removed */ }

    }, { tag: "history-push" })

    // After the update completes and Lexical reconciles, apply highlight
    // inheritance. Done outside the update to ensure final positions are settled.
    setTimeout(() => {
      try {
        this.editor.update(() => {
          for (const key of rootKeys) {
            const node = $getNodeByKey(key)
            if (node && node.getParent() && $isListItemNode(node)) {
              this.#applyOrRestoreParentHighlight(node)
            }
          }
        })
      } catch (_) { /* nodes may have been unwrapped/removed */ }
    }, 0)

    requestAnimationFrame(() => {
      this.#syncSelectionClasses()
      this.#wrappedOrigins.syncDOMAttributes()
      // Double-RAF: first waits for Lexical's DOM reconciliation,
      // second ensures layout is computed before positioning
      requestAnimationFrame(() => {
        this.#dragAndDrop?.repositionHandle()
        this.#syncBulletOffsets()
        this.#dragAndDrop?.unsuppressHover()
        this.#scrollFocusedBlockIntoView()
      })
    })
  }

  #filterToRootKeys(selectedKeys) {
    const keySet = new Set(selectedKeys)
    const rootKeys = []

    this.editor.getEditorState().read(() => {
      for (const key of selectedKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        // Walk up through list structure to check if any ancestor is also selected
        let isChild = false
        let current = node.getParent()
        while (current) {
          if ($isListItemNode(current) && $isStructuralWrapper(current)) {
            // Found a structural wrapper — check if the item BEFORE it is selected
            const textItem = current.getPreviousSibling()
            if (textItem && keySet.has(textItem.getKey())) {
              isChild = true
              break
            }
          }
          current = current.getParent()
        }

        if (!isChild) {
          rootKeys.push(key)
        }
      }
    })

    return rootKeys
  }

  // Sync bullet ::before offset on all selected list items with wrapped content.
  // Listen for wrapped-block sync requests from edit-mode operations
  // (e.g., turn-into wrapping in contents.js). Syncs both bullet offset
  // and drag handle position.
  #registerBulletOffsetSyncListener() {
    const handler = (event) => {
      this.#dragAndDrop?.syncBulletOffset(event.target)
      this.#dragAndDrop?.repositionHandle()
    }
    const rootElement = this.root
    rootElement?.addEventListener("lexxy:sync-wrapped-block", handler)
    this.#cleanupFns.push(() => rootElement?.removeEventListener("lexxy:sync-wrapped-block", handler))
  }

  #syncBulletOffsets() {
    if (!this.#dragAndDrop) return
    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (el) this.#dragAndDrop.syncBulletOffset(el)
    }
  }

  #scrollFocusedBlockIntoView() {
    if (!this.#focusKey) return
    const el = this.editor.getElementByKey(this.#focusKey)
    if (!el) return
    const margin = 150
    const rect = el.getBoundingClientRect()
    if (rect.top < margin) {
      window.scrollBy({ top: rect.top - margin, behavior: "smooth" })
    } else if (rect.bottom > window.innerHeight - margin) {
      window.scrollBy({ top: rect.bottom - window.innerHeight + margin, behavior: "smooth" })
    }
  }

  // When a parent item has selected children, set a CSS variable on the parent
  // so its ::after covers the entire parent+children area as one rectangle.
  // Measures actual DOM positions so it works regardless of margins/padding.
  //
  // Context-aware height: flat-level parents use larger extensions (matching
  // flat-list 32px edge items), deeply nested parents use 30px uniform pitch.
  #syncParentSelectionHeight() {
    // Clear previous parent height variables and flush-top class
    for (const el of this.#parentHeightElements) {
      el.style.removeProperty("--parent-selection-height")
    }
    this.#parentHeightElements.clear()
    for (const el of this.#flushTopElements) {
      el.classList.remove("lexxy-editor__block--flush-top")
    }
    this.#flushTopElements.clear()

    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (!el || el.tagName !== "LI") continue

      const wrapper = el.nextElementSibling
      if (!wrapper?.classList.contains(NESTED_LISTITEM_CLASS)) continue
      if (!wrapper.querySelector(`.${BLOCK_SELECTED_CLASS}`)) continue

      // Deeply nested = inside a structural wrapper (not a root-level item).
      const isDeeplyNested = !!el.closest(`li.${NESTED_LISTITEM_CLASS}`)

      // Read the parent's actual computed ::after top to determine topExt.
      // CSS rules (position-sensitive, mixed-list) may set -2px, -4px, or -6px.
      // Reading the computed value avoids mismatches between JS and CSS.
      const isFirst = el === el.parentElement.firstElementChild && !isDeeplyNested
      const parentAfterTop = parseFloat(getComputedStyle(el, "::after").top)
      let topExt = !isNaN(parentAfterTop) ? Math.abs(parentAfterTop) : (isFirst ? 6 : 2)

      // If the previous sibling is a wrapper with a selected child whose
      // parent is NOT selected, reduce topExt to 0 to leave a 2px gap
      // (child extends 4px below + 0 top + 6px margin = 2px visual gap).
      const prevSib = el.previousElementSibling
      if (prevSib?.classList.contains(NESTED_LISTITEM_CLASS)) {
        const prevParent = prevSib.previousElementSibling
        if (!prevParent?.classList.contains(BLOCK_SELECTED_CLASS) &&
            prevSib.querySelector(`.${BLOCK_SELECTED_CLASS}`)) {
          topExt = 0
          el.classList.add("lexxy-editor__block--flush-top")
          this.#flushTopElements.add(el)
        }
      }

      // Deeply nested parents use 30px uniform pitch (bottomExt=4).
      // Flat-level parents depend on position: last group in the list
      // gets 6 (62px, matching flat last-child), middle groups get 2
      // (58px) so there's a 2px gap between adjacent groups.
      let bottomExt = 4
      if (!isDeeplyNested) {
        const isLastInList = !wrapper.nextElementSibling ||
          wrapper === wrapper.parentElement.lastElementChild
        bottomExt = isLastInList ? 6 : 2
      }

      const parentRect = el.getBoundingClientRect()

      // Use the last SELECTED child's bottom, not the full wrapper bottom.
      // This shrinks the rectangle as children are deselected one at a time.
      //
      // Keep bottomExt at the list-rhythm value (2 mid / 6 last / 4 deeply
      // nested) set above. The child's own ::after inset (which may be -4px
      // or -7px for attachments) would bloat the parent rectangle past the
      // next sibling's highlight-top and eat the 2px gap — and since the
      // child's ::after is suppressed by the parent fill (see the CSS rule
      // at line ~2042), there's nothing to "cover" anyway.
      //
      // Exception: when the last selected child IS the wrapper's last li,
      // use wrapper.bottom instead. The wrapper is a BFC (display: flow-root)
      // so any margin-bottom on the deepest wrapped content (figure's 16px,
      // heading's 16px, etc.) is trapped inside and shows up as wrapper
      // height — getBoundingClientRect on the child itself doesn't include
      // that trapped margin, so using it would leave the trapped space
      // unhighlighted below the child.
      const selectedChildren = wrapper.querySelectorAll(`.${BLOCK_SELECTED_CLASS}`)
      let bottom
      if (selectedChildren.length > 0) {
        const lastChild = selectedChildren[selectedChildren.length - 1]
        const allLisInWrapper = wrapper.querySelectorAll("li")
        const isLastInWrapper = allLisInWrapper[allLisInWrapper.length - 1] === lastChild
        bottom = isLastInWrapper
          ? wrapper.getBoundingClientRect().bottom
          : lastChild.getBoundingClientRect().bottom
      } else {
        bottom = wrapper.getBoundingClientRect().bottom
      }

      const height = (bottom - parentRect.top) + topExt + bottomExt
      el.style.setProperty("--parent-selection-height", `${height}px`)
      this.#parentHeightElements.add(el)
    }

  }

  // Extend the ::after of "isolated" selected LI leaves — leaves whose list
  // siblings aren't selected and whose ancestor wrappers aren't selected —
  // so the visible gap to adjacent unselected content reads at the 4px
  // mixed-list rhythm, regardless of how far structurally the next/prev
  // visible block sits (wrapper boundaries, trapped margins, outer list
  // spacing). Without this, a solo-selected leaf inside a wrapper chain
  // floats with a visible gap much larger than 4px (e.g. ~14px when the
  // next visible thing is outside the wrapper). With matched-pair selections
  // the default insets already produce 4px; this only engages when there's
  // nothing to pair with. Sets two CSS custom properties read by a
  // dedicated CSS rule; consumes no flow layout.
  #syncIsolatedLeafInsets() {
    for (const el of this.#isolatedLeafElements) {
      el.style.removeProperty("--leaf-top-inset")
      el.style.removeProperty("--leaf-bottom-inset")
      el.classList.remove("lexxy-editor__block--isolated-leaf")
    }
    this.#isolatedLeafElements.clear()

    const TARGET_GAP = 4

    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (!el || el.tagName !== "LI") continue
      if (el.classList.contains(NESTED_LISTITEM_CLASS)) continue

      // Isolated: no selected ancestor wrapper AND no selected sibling in
      // the same list. If either holds, pair rhythm handles the rendering.
      if (this.#hasSelectedAncestor(el)) continue
      if (this.#hasSelectedListSibling(el)) continue

      const { prev, next } = this.#findAdjacentUnselectedBlocks(el)
      const rect = el.getBoundingClientRect()

      // Only extend if the target is non-selected — otherwise the target
      // has its own highlight and the default insets already space us
      // correctly (and extending would overlap it).
      if (prev && !prev.classList.contains(BLOCK_SELECTED_CLASS)) {
        const prevBottom = prev.getBoundingClientRect().bottom
        const topInset = Math.max(TARGET_GAP, rect.top - (prevBottom + TARGET_GAP))
        el.style.setProperty("--leaf-top-inset", `-${topInset}px`)
      }
      if (next && !next.classList.contains(BLOCK_SELECTED_CLASS)) {
        const nextTop = next.getBoundingClientRect().top
        const bottomInset = Math.max(TARGET_GAP, (nextTop - TARGET_GAP) - rect.bottom)
        el.style.setProperty("--leaf-bottom-inset", `-${bottomInset}px`)
      }

      if (el.style.getPropertyValue("--leaf-top-inset") ||
          el.style.getPropertyValue("--leaf-bottom-inset")) {
        el.classList.add("lexxy-editor__block--isolated-leaf")
        this.#isolatedLeafElements.add(el)
      }
    }
  }

  #hasSelectedAncestor(el) {
    let p = el.parentElement
    while (p && p !== this.root) {
      if (p.classList.contains(BLOCK_SELECTED_CLASS)) return true
      p = p.parentElement
    }
    return false
  }

  #hasSelectedListSibling(el) {
    if (!el.parentElement) return false
    for (const sib of el.parentElement.children) {
      if (sib !== el && sib.classList.contains(BLOCK_SELECTED_CLASS)) return true
    }
    return false
  }

  // Walk out to the first structural sibling on each side, crossing
  // through ancestor ULs and nested wrappers. This gives the actual
  // neighboring visible block in document order — the element from
  // which the visible gap to `el` is measured.
  #findAdjacentUnselectedBlocks(el) {
    let node = el
    let prev = null
    while (node && node !== this.root) {
      if (node.previousElementSibling) { prev = node.previousElementSibling; break }
      node = node.parentElement
    }
    node = el
    let next = null
    while (node && node !== this.root) {
      if (node.nextElementSibling) { next = node.nextElementSibling; break }
      node = node.parentElement
    }
    return { prev, next }
  }

  // -- Selection state snapshot/restore ---------------------------------------
  // Called by the SelectionHistory module (src/editor/block_selection/
  // selection_history.js) via its snapshot/restore callbacks. Kept here
  // because they mutate extension-private state (selectedBlockKeys, anchor,
  // focus, mode) that can't cleanly cross the module boundary.

  #snapshotSelectionState() {
    return {
      keys: new Set(this.#selectedBlockKeys),
      anchor: this.#anchorKey,
      focus: this.#focusKey,
      mode: this.#mode
    }
  }

  #restoreSelectionState(state) {
    if (state.mode === "block-select") {
      this.#mode = "block-select"
      this.root?.classList.add(BLOCK_SELECTION_ACTIVE_CLASS)
      this.#selectedBlockKeys = new Set(state.keys)
      this.#anchorKey = state.anchor
      this.#focusKey = state.focus
      this.editor.update(() => { $setSelection(null) })
      this.root?.focus({ preventScroll: true })
      this.#syncSelectionClasses()
    } else {
      this.#exitBlockSelectMode()
    }
  }

  // Move a group of items as a single atomic unit. Detaches all items,
  // finds the target position, and re-inserts them together. This prevents
  // reordering that happens when processing items individually.
  #moveGroupAtomically(rootKeys, direction) {
    const isUp = direction === "up"

    // 1. Collect all nodes with their structural wrappers, in document order
    const group = [] // [{ node, wrapper }]
    for (const key of rootKeys) {
      const node = $getNodeByKey(key)
      if (!node) continue
      const wrapper = this.#getOwnStructuralWrapper(node)
      group.push({ node, wrapper })
    }
    if (group.length === 0) return

    // 1b. Detect groups that span multiple parents.
    // Two cases: (a) root-level mixed group after list exit (standalone lists +
    // standalone blocks), or (b) items at different nesting depths within the
    // same list hierarchy.
    if (group.length > 1) {
      const firstParent = group[0].node.getParent()
      const multiParent = group.some(g => !g.node.getParent()?.is(firstParent))

      if (multiParent) {
        // Check if any item is NOT inside a list (root-level mixed group)
        const anyOutsideList = group.some(g => !$isListNode(g.node.getParent()))
        // Check if any item is in a root-level standalone list
        const anyInRootList = group.some(g => {
          const p = g.node.getParent()
          return $isListNode(p) && !$isListItemNode(p.getParent())
        })

        if (anyOutsideList || anyInRootList) {
          // Case (a): root-level mixed group — resolve to root-level elements.
          //
          // If only SOME items of a root-level list are selected, first
          // extract them into a new standalone list so unselected siblings
          // don't get dragged along. Group list items by their parent list,
          // and for each list with a partial selection, split off the
          // selected items into a new sibling list in the same document
          // position. Then resolve to the right root-level node.
          const groupKeys = new Set(group.map(g => g.node.getKey()))
          const listToItems = new Map() // rootList -> selected ListItemNodes
          for (const { node } of group) {
            if (!$isListItemNode(node)) continue
            const parent = node.getParent()
            if ($isListNode(parent) && !$isListItemNode(parent.getParent())) {
              if (!listToItems.has(parent)) listToItems.set(parent, [])
              listToItems.get(parent).push(node)
            }
          }

          // Remap: for partially-selected lists, split off the selected items.
          const listRemap = new Map() // originalList -> list to resolve to
          for (const [ list, items ] of listToItems) {
            const realChildren = list.getChildren().filter(c => $isListItemNode(c) && !$isStructuralWrapper(c))
            const allSelected = realChildren.every(c => groupKeys.has(c.getKey()))
            if (allSelected) {
              listRemap.set(list, list)
              continue
            }
            const splitList = $createListNode(list.getListType())
            for (const item of items) splitList.append(item)
            list.insertAfter(splitList)
            listRemap.set(list, splitList)
          }

          const resolved = []
          const seen = new Set()
          for (const { node } of group) {
            let rootEl = node
            if ($isListItemNode(node)) {
              const parent = node.getParent()
              if ($isListNode(parent) && !$isListItemNode(parent.getParent())) {
                rootEl = listRemap.get(parent) || parent
              }
            }
            const key = rootEl.getKey()
            if (!seen.has(key)) {
              seen.add(key)
              resolved.push({ node: rootEl, wrapper: null })
            }
          }
          this.#moveRootLevelGroup(resolved, group, direction)
          return
        }

        // Case (b): items at different depths within a list hierarchy.
        // Promote the deeper items to the shallowest parent level so the
        // group unifies before moving horizontally.
        this.#normalizeGroupDepth(group, direction)
        return
      }
    }

    // 2. Find the target: the sibling above/below the group
    const edgeNode = isUp ? group[0].node : group[group.length - 1].node
    const edgeWrapper = isUp ? null : group[group.length - 1].wrapper
    const edgeEnd = edgeWrapper || edgeNode

    let target = isUp ? edgeNode.getPreviousSibling() : edgeEnd.getNextSibling()
    // Skip structural wrappers that aren't part of the group
    while (target && $isListItemNode(target) && $isStructuralWrapper(target)) {
      target = isUp ? target.getPreviousSibling() : target.getNextSibling()
    }
    // Decorator nodes (HR, attachments, images): Lexical keeps empty separator
    // paragraphs between adjacent decorators. Skip them to reach the real
    // target, matching the single-item behavior in #moveTopLevelBlock.
    if (target && group.some(({ node }) => $isDecoratorNode(node))) {
      while (target && $isParagraphNode(target) && target.getTextContentSize() === 0) {
        const beyond = isUp ? target.getPreviousSibling() : target.getNextSibling()
        if (beyond) {
          target = beyond
        } else {
          break
        }
      }
    }

    if (!target) {
      // At list boundary — promote the group out.
      const firstParent = group[0].node.getParent()
      if ($isListNode(firstParent)) {
        // When the group IS the entire list (all items are selected) and
        // the list is at root level, move the list itself as a unit rather
        // than exiting — exit would re-wrap items in a new standalone list,
        // causing an infinite exit loop via Lexical's adjacent-list merge.
        const listParent = firstParent.getParent()
        if (!$isListItemNode(listParent) && this.#groupSpansEntireList(group, firstParent)) {
          const neighbor = isUp ? firstParent.getPreviousSibling() : firstParent.getNextSibling()
          if (neighbor) {
            if ($isListNode(neighbor) && neighbor.getListType() === firstParent.getListType()) {
              // Adjacent same-type list: enter it instead of swapping
              this.#moveGroupIntoList(group, neighbor, direction)
            } else {
              // Swap list with the adjacent root-level element
              firstParent.remove()
              if (isUp) neighbor.insertBefore(firstParent)
              else neighbor.insertAfter(firstParent)
            }
          }
          // else: at document boundary — nothing to do
          return
        }
        this.#moveGroupAtBoundary(group, direction)
      }
      // At document boundary (root level, no sibling) — nothing to do
      return
    }

    // 3. Has a target sibling: dispatch based on context.
    if (!$isListItemNode(target)) {
      if ($isListNode(target)) {
        // Root-level group entering a list
        this.#moveGroupIntoList(group, target, direction)
      } else {
        // Root-level swap with a non-list sibling
        for (let i = group.length - 1; i >= 0; i--) {
          group[i].node.remove()
        }
        if (isUp) {
          for (let i = 0; i < group.length; i++) {
            target.insertBefore(group[i].node)
          }
        } else {
          let insertAfter = target
          for (let i = 0; i < group.length; i++) {
            insertAfter.insertAfter(group[i].node)
            insertAfter = group[i].node
          }
        }
      }
      return
    }

    // Within-list movement: nest the group under the target sibling,
    // matching single-item depth-first traversal behavior.
    // DOWN → become first children of target's nested list
    // UP → become last children of target's nested list
    this.#nestGroupUnderSibling(group, target, direction)
  }

  // Move a group of root-level elements (resolved from a mixed-parent group).
  // Handles standalone lists, standalone blocks, and entering adjacent lists.
  // `resolved` has root-level elements, `originalGroup` has the raw selected nodes.
  #moveRootLevelGroup(resolved, originalGroup, direction) {
    const isUp = direction === "up"
    const edgeNode = isUp ? resolved[0].node : resolved[resolved.length - 1].node
    let target = isUp ? edgeNode.getPreviousSibling() : edgeNode.getNextSibling()

    // Skip empty separator paragraphs (Lexical's ProvisionalParagraphNode sits
    // between adjacent decorators — figures, HRs, etc.). Without this, when the
    // edge of the group is a decorator, the group moves past a single invisible
    // separator each press and visually appears frozen. Matches the single-item
    // skip in #moveTopLevelBlock and the same-parent group skip in
    // #moveGroupAtomically (line ~2061).
    while (target && $isParagraphNode(target) && target.getTextContentSize() === 0) {
      const beyond = isUp ? target.getPreviousSibling() : target.getNextSibling()
      if (!beyond) break
      target = beyond
    }

    if (!target) return // at document boundary

    // If target is a list, the group is entering a list
    if ($isListNode(target)) {
      this.#moveGroupIntoList(resolved, target, direction)
      return
    }

    // Moving UP past a cursor separator paragraph: the element above the
    // separator may be a list. Enter it instead of swapping, which would
    // cause Lexical to merge the standalone list with the original list.
    if (isUp && $isParagraphNode(target) && target.getTextContentSize() === 0) {
      const above = target.getPreviousSibling()
      if (above && $isListNode(above)) {
        target.remove()
        this.#moveGroupIntoList(resolved, above, direction)
        return
      }
    }

    // Simple root-level swap: move all elements past the target
    for (let i = resolved.length - 1; i >= 0; i--) {
      resolved[i].node.remove()
    }
    if (isUp) {
      for (let i = 0; i < resolved.length; i++) {
        target.insertBefore(resolved[i].node)
      }
    } else {
      let insertAfter = target
      for (let i = 0; i < resolved.length; i++) {
        insertAfter.insertAfter(resolved[i].node)
        insertAfter = resolved[i].node
      }
    }
  }

  // When a selected group spans multiple nesting depths within a list,
  // promote the deeper items to the shallowest parent level. This unifies
  // the group at one depth so the next keypress can move them together.
  #normalizeGroupDepth(group, direction) {
    // Find the shallowest (closest to root) parent list among all group items
    let shallowest = null
    let shallowestDepth = Infinity
    for (const { node } of group) {
      let depth = 0
      let current = node.getParent()
      while (current) {
        if ($isListNode(current)) depth++
        current = current.getParent()
      }
      if (depth < shallowestDepth) {
        shallowestDepth = depth
        shallowest = node.getParent()
      }
    }
    if (!shallowest) return

    // Collect items that are deeper than the shallowest and promote them
    const deeper = []
    for (const entry of group) {
      if (!entry.node.getParent()?.is(shallowest)) {
        deeper.push(entry)
      }
    }
    if (deeper.length === 0) return

    const currentList = deeper[0].node.getParent()
    if ($isListNode(currentList)) {
      this.#promoteGroupOneLevel(deeper, currentList, direction)
    }
  }

  // Two-phase boundary crossing for group movement.
  // When a selected group reaches the edge of its list (no more siblings in
  // the move direction), this method handles crossing the boundary.
  //
  // Root-level exit: uses a cursor paragraph as a stable reference point,
  // then processes each item individually (unwrapping wrapped blocks,
  // wrapping regular items in standalone lists).
  //
  // Nested promotion: detaches all items and re-inserts them at the parent
  // list level as a unit.
  #moveGroupAtBoundary(group, direction) {
    const currentList = group[0].node.getParent()
    if (!$isListNode(currentList)) return

    const listParent = currentList.getParent()

    // Root-level list: exit the list entirely
    if (!$isListItemNode(listParent)) {
      this.#exitGroupFromList(group, currentList, direction)
      return
    }

    // Nested list: promote to parent list level (one level per move,
    // matching single-item depth-first traversal behavior)
    this.#promoteGroupOneLevel(group, currentList, direction)
  }

  // Exit a group from its list to root level using the cursor approach.
  // A cursor paragraph acts as a stable reference point for placement,
  // ensuring items maintain document order regardless of how individual
  // transformations (wrapping/unwrapping) affect the tree.
  #exitGroupFromList(group, sourceList, direction) {
    const isUp = direction === "up"

    // Find the outermost list (handles deeply nested items)
    let outerList = sourceList
    let p = sourceList.getParent()
    while (p && ($isListItemNode(p) || $isListNode(p))) {
      if ($isListNode(p)) outerList = p
      p = p.getParent()
    }
    const listType = sourceList.getListType()

    // Phase 1: Find or create cursor at landing zone. Reuse an adjacent
    // empty paragraph if one exists (e.g. from a previous exit cycle) so
    // repeated exit→enter→exit doesn't pile up stale paragraphs.
    let cursor = null
    const adjacent = isUp ? outerList.getPreviousSibling() : outerList.getNextSibling()
    if (adjacent && $isParagraphNode(adjacent) && adjacent.getTextContentSize() === 0) {
      cursor = adjacent
    } else {
      cursor = $createParagraphNode()
      if (isUp) outerList.insertBefore(cursor)
      else outerList.insertAfter(cursor)
    }

    // Phase 2: Transform and place each item relative to the cursor.
    // Moving UP: insert before cursor → items stack above the list in order.
    // Moving DOWN: insert after cursor/prev → items stack below the list.
    let insertRef = cursor

    // Batch consecutive regular list items into a single standalone list
    // to prevent Lexical's adjacent-list merge from re-combining them.
    let regularBatch = null

    function flushBatch() {
      if (!regularBatch) return
      if (isUp) {
        cursor.insertBefore(regularBatch)
      } else {
        insertRef.insertAfter(regularBatch)
        insertRef = regularBatch
      }
      regularBatch = null
    }

    for (const { node, wrapper } of group) {
      if (!node.getParent()) continue

      // Origin-aware branching: user-wrapped items stay as wrapped list
      // items in a new root-level list (preserving their structure and
      // any nested children). Movement-wrapped items extract to standalone
      // — they only became list items as a side-effect of being moved
      // through a list, and the user wants them back at root level.
      if (this.#wrappedOrigins.isWrapped(node) && !this.#wrappedOrigins.isUser(node)) {
        // Flush any batched regular items before inserting an extracted block
        flushBatch()

        let childrenList = null
        if (wrapper) {
          const innerList = wrapper.getChildren().find(c => $isListNode(c))
          if (innerList) {
            innerList.remove()
            childrenList = innerList
          }
          wrapper.remove()
        }
        const extracted = this.#extractWrappedContent(node)
        if (extracted) {
          this.#updateKeyAfterUnwrap(node.getKey(), extracted.getKey())
          node.remove()

          if (isUp) {
            cursor.insertBefore(extracted)
            if (childrenList) cursor.insertBefore(childrenList)
          } else {
            insertRef.insertAfter(extracted)
            insertRef = extracted
            if (childrenList) {
              insertRef.insertAfter(childrenList)
              insertRef = childrenList
            }
          }
        }
      } else {
        // Regular list item OR user-wrapped list item: batch into a
        // root-level list, keeping any structural wrapper with nested
        // children attached so the subtree stays intact.
        if (!regularBatch) regularBatch = $createListNode(listType)
        if (wrapper) wrapper.remove()
        node.remove()
        regularBatch.append(node)
        if (wrapper) regularBatch.append(wrapper)
      }
    }

    // Flush any remaining regular items
    flushBatch()

    // Phase 3: Clean up empty source list, then remove cursor.
    // Clean up BEFORE cursor removal so the source list is gone if empty,
    // preventing false adjacency detection.
    this.#cleanupEmptyList(sourceList)

    // Cursor removal can cause adjacent same-type lists to merge during
    // Lexical reconciliation. Keep the cursor as a separator when the
    // prev and next siblings are both lists of the same type.
    if (cursor.getParent()) {
      const prev = cursor.getPreviousSibling()
      const next = cursor.getNextSibling()
      const wouldMerge = prev && $isListNode(prev)
        && next && $isListNode(next)
        && prev.getListType() === next.getListType()

      if (!wouldMerge) cursor.remove()
    }
  }

  // Promote a group one level up within a nested list.
  // Detaches all items and re-inserts them at the parent list level.
  #promoteGroupOneLevel(group, currentList, direction) {
    const isUp = direction === "up"
    const listParent = currentList.getParent()

    // Determine insert anchor at the parent level
    let insertAnchor
    if ($isListItemNode(listParent) && $isStructuralWrapper(listParent)) {
      const textSibling = listParent.getPreviousSibling()
      insertAnchor = (isUp && textSibling && $isListItemNode(textSibling))
        ? textSibling : listParent
    } else {
      insertAnchor = currentList
    }

    // Detach all items (reverse order to preserve sibling references)
    for (let i = group.length - 1; i >= 0; i--) {
      if (group[i].wrapper) group[i].wrapper.remove()
      group[i].node.remove()
    }

    // Re-insert at parent level
    if (isUp) {
      for (let i = 0; i < group.length; i++) {
        insertAnchor.insertBefore(group[i].node)
        if (group[i].wrapper) group[i].node.insertAfter(group[i].wrapper)
      }
    } else {
      let insertAfter = insertAnchor
      for (let i = 0; i < group.length; i++) {
        insertAfter.insertAfter(group[i].node)
        if (group[i].wrapper) group[i].node.insertAfter(group[i].wrapper)
        insertAfter = group[i].wrapper || group[i].node
      }
    }

    // Cleanup empty source list
    this.#cleanupEmptyList(currentList)

    // Lexical may insert placeholder empty LIs when items are removed from
    // a nested list. Prune any empty non-structural LIs at the target level.
    const targetList = group[0].node.getParent()
    if (targetList && $isListNode(targetList)) {
      for (const child of [ ...targetList.getChildren() ]) {
        if ($isListItemNode(child) && !$isStructuralWrapper(child)
            && child.getTextContentSize() === 0
            && !this.#selectedBlockKeys.has(child.getKey())) {
          child.remove()
        }
      }
    }
  }

  // Move a group of standalone blocks into an adjacent list.
  // All items enter at root level of the target list, maintaining
  // document order. Non-list blocks get wrapped in ListItemNodes.
  // Standalone lists have their items extracted and inserted directly.
  //   DOWN: items placed before the first real item in the target list
  //   UP: items placed after the last real item in the target list
  #moveGroupIntoList(group, targetList, direction) {
    const isUp = direction === "up"
    const anchor = isUp
      ? this.#findLastRealItem(targetList)
      : this.#findFirstRealItem(targetList)

    // Track insert position: for DOWN, insertBefore anchor; for UP, insertAfter
    let insertRef = anchor

    for (const { node } of group) {
      if (!node.getParent()) continue

      // Collect items to insert from this node
      const toInsert = [] // [{ listItem, oldKey?, isWrapped? }]

      if ($isListNode(node)) {
        // Standalone list: extract its children directly
        for (const child of [ ...node.getChildren() ]) {
          toInsert.push({ listItem: child })
        }
        node.remove()
      } else {
        // Non-list block (heading, blockquote, paragraph): wrap in ListItemNode
        const oldKey = node.getKey()
        const listItem = $createListItemNode()
        listItem.append(node)
        toInsert.push({ listItem, oldKey, isWrapped: true })
      }

      // Insert all items at the boundary position
      for (const { listItem, oldKey, isWrapped } of toInsert) {
        if (isUp) {
          if (insertRef) {
            insertRef.insertAfter(listItem)
          } else {
            targetList.append(listItem)
          }
          insertRef = listItem
        } else {
          if (anchor) {
            anchor.insertBefore(listItem)
          } else {
            targetList.append(listItem)
          }
        }

        if (isWrapped) {
          this.#wrappedOrigins.trackMovement(listItem.getKey())
          const newKey = listItem.getKey()
          if (this.#selectedBlockKeys.has(oldKey)) {
            this.#selectedBlockKeys.delete(oldKey)
            this.#selectedBlockKeys.add(newKey)
            if (this.#anchorKey === oldKey) this.#anchorKey = newKey
            if (this.#focusKey === oldKey) this.#focusKey = newKey
          }
        }

        // Inherit color from the parent list item if it has one
        this.#inheritParentHighlight(listItem)
      }
    }
  }

  #moveSingleBlock(nodeKey, direction) {
    const node = $getNodeByKey(nodeKey)
    if (!node || !node.getParent()) return

    if ($isListItemNode(node)) {
      this.#moveListItem(node, direction)
    } else {
      const parent = node.getParent()
      if ($isListItemNode(parent)) {
        this.#moveListItem(parent, direction)
      } else {
        this.#moveTopLevelBlock(node, direction)
      }
    }
  }

  #moveListItem(node, direction) {
    const parent = node.getParent()
    if (!$isListNode(parent)) return

    const isDown = direction === "down"
    const parentOfList = parent.getParent()
    const isRootLevel = !$isListItemNode(parentOfList)

    // If this is the only real item in a root-level list, check if it
    // should unwrap (hidden-bullet block) or move the whole list.
    // User-wrapped items skip the unwrap path — the list moves as a unit
    // so the item keeps its wrapping. Only Shift+Tab unwraps them.
    if (isRootLevel && this.#countRealItems(parent) === 1) {
      if (!this.#wrappedOrigins.isUser(node)) {
        const unwrapped = this.#unwrapIfNonListContent(node)
        if (unwrapped) {
          // Hidden-bullet block: unwrap back to standalone.
          unwrapped.remove()
          if (isDown) {
            parent.insertAfter(unwrapped)
          } else {
            parent.insertBefore(unwrapped)
          }
          this.#updateKeyAfterUnwrap(node.getKey(), unwrapped.getKey())
          node.remove()
          this.#cleanupEmptyList(parent)
          return
        }
      }
      // Normal single list item (or user-wrapped): move the entire list as a block
      this.#moveTopLevelBlock(parent, direction)
      return
    }

    // Find the adjacent sibling, skipping structural wrapper ListItemNodes
    let sibling = isDown ? node.getNextSibling() : node.getPreviousSibling()
    while (sibling && $isListItemNode(sibling) && $isStructuralWrapper(sibling)) {
      sibling = isDown ? sibling.getNextSibling() : sibling.getPreviousSibling()
    }

    if (sibling && $isListItemNode(sibling)) {
      // Has adjacent text sibling → nest under it
      this.#nestListItemUnderSibling(node, sibling, parent, isDown)
    } else {
      // At boundary of list (no adjacent sibling) — promote to parent level.
      // Works for both wrapped blocks and regular list items uniformly.
      // #promoteListItem differentiates behavior at root level:
      //   - Wrapped blocks: extract and exit as standalone elements
      //   - Regular list items: wrap in new sibling list (blocked at doc start)
      this.#promoteListItem(node, parent, isDown)
    }
  }

  #countRealItems(listNode) {
    let count = 0
    for (const child of listNode.getChildren()) {
      if ($isListItemNode(child) && !$isStructuralWrapper(child)) {
        count++
      }
    }
    return count
  }

  // Nest a list item as a child of an adjacent sibling.
  // Moving UP → become the LAST child of the previous sibling's nested list.
  // Moving DOWN → become the FIRST child of the next sibling's nested list.
  //
  // Lexical's list structure uses a SEPARATE structural wrapper ListItemNode
  // (with class NESTED_LISTITEM_CLASS) to hold nested lists. The text
  // ListItemNode and the wrapper are siblings, NOT parent-child. Appending a
  // ListNode directly to a text ListItemNode corrupts its bullet marker
  // because EarlyEscapeListItemNode.#updateBulletDepth removes data-bullet-depth
  // when the item has a ListNode child.
  // Nest an entire group under a target sibling, following the same
  // depth-first traversal pattern as single-item movement.
  // DOWN → group becomes first children of target's nested list
  // UP → group becomes last children of target's nested list
  #nestGroupUnderSibling(group, target, direction) {
    const isDown = direction === "down"
    const currentList = group[0].node.getParent()

    // Find or create the target's structural wrapper and nested list
    let nestedList = null
    const wrapperCandidate = target.getNextSibling()
    if (wrapperCandidate && $isListItemNode(wrapperCandidate)
        && $isStructuralWrapper(wrapperCandidate)) {
      for (const child of wrapperCandidate.getChildren()) {
        if ($isListNode(child)) {
          nestedList = child
          break
        }
      }
    }

    // Check if moving will empty the source list
    const sourceList = group[0].node.getParent()
    let sourceWrapperKey = null
    if (sourceList && $isListNode(sourceList)
        && this.#countRealItems(sourceList) <= group.length) {
      const sourceWrapper = sourceList.getParent()
      if (sourceWrapper && $isListItemNode(sourceWrapper)
          && $isStructuralWrapper(sourceWrapper)) {
        sourceWrapperKey = sourceWrapper.getKey()
      }
    }

    if (!nestedList) {
      nestedList = $createListNode(currentList.getListType())
      const wrapper = $createListItemNode()
      wrapper.append(nestedList)
      target.insertAfter(wrapper)
    }

    // Move all group items into the nested list
    if (isDown) {
      // Insert as first children (before existing), maintaining order.
      // firstChild is captured once — all items insertBefore it to keep order.
      const firstChild = nestedList.getFirstChild()
      for (let i = 0; i < group.length; i++) {
        const { node, wrapper } = group[i]
        if (wrapper) wrapper.remove()
        node.remove()
        if (firstChild) {
          firstChild.insertBefore(node)
        } else {
          nestedList.append(node)
        }
        if (wrapper) node.insertAfter(wrapper)
      }
    } else {
      // Insert as last children (after existing), maintaining order
      for (let i = 0; i < group.length; i++) {
        const { node, wrapper } = group[i]
        if (wrapper) wrapper.remove()
        node.remove()
        nestedList.append(node)
        if (wrapper) nestedList.append(wrapper)
      }
    }

    // Cleanup empty source list/wrapper
    if (sourceWrapperKey) {
      this.#forceDestroyWrapper(sourceWrapperKey)
    }
  }

  #nestListItemUnderSibling(node, sibling, currentList, isDown) {
    // In Lexical's list model, a text ListItemNode's nested children live
    // in a structural wrapper ListItemNode that is the NEXT sibling of the
    // text item. Look for an existing wrapper after the sibling, making
    // sure it's actually a structural wrapper (not the node being moved).
    let nestedList = null
    const wrapperCandidate = sibling.getNextSibling()

    if (wrapperCandidate && $isListItemNode(wrapperCandidate)
        && $isStructuralWrapper(wrapperCandidate)
        && !wrapperCandidate.is(node)) {
      for (const child of wrapperCandidate.getChildren()) {
        if ($isListNode(child)) {
          nestedList = child
          break
        }
      }
    }

    // Capture the node's own structural wrapper (children) BEFORE the move.
    // It travels with the node as a unit.
    const ownWrapper = this.#getOwnStructuralWrapper(node)

    // Check if moving the node will empty its parent list BEFORE the move.
    // If so, save the structural wrapper key so we can destroy it after.
    const sourceList = node.getParent()
    let sourceWrapperKey = null
    if (sourceList && $isListNode(sourceList) && this.#countRealItems(sourceList) <= 1) {
      const sourceWrapper = sourceList.getParent()
      if (sourceWrapper && $isListItemNode(sourceWrapper) && $isStructuralWrapper(sourceWrapper)) {
        sourceWrapperKey = sourceWrapper.getKey()
      }
    }

    if (!nestedList) {
      // Create a new structural wrapper + nested list after the sibling
      nestedList = $createListNode(currentList.getListType())
      const wrapper = $createListItemNode()
      wrapper.append(nestedList)
      sibling.insertAfter(wrapper)
    }

    // Move the node into the nested list. The append/insertBefore calls
    // atomically detach the node from its old parent and insert it here —
    // no separate node.remove() call, so the old list is never in an empty
    // state that Lexical could normalize with placeholder items.
    if (isDown) {
      const firstChild = nestedList.getFirstChild()
      if (firstChild) {
        firstChild.insertBefore(node)
      } else {
        nestedList.append(node)
      }
    } else {
      nestedList.append(node)
    }

    // Move the node's children wrapper right after the node in the new list
    if (ownWrapper) {
      node.insertAfter(ownWrapper)
    }

    // Destroy the old structural wrapper if the move emptied its list
    if (sourceWrapperKey) {
      this.#forceDestroyWrapper(sourceWrapperKey)
    }
  }

  // Get the structural wrapper (children container) that immediately follows
  // a list item, if any. Returns null if the node has no children.
  #getOwnStructuralWrapper(node) {
    const next = node.getNextSibling()
    if (next && $isListItemNode(next) && $isStructuralWrapper(next)) {
      return next
    }
    return null
  }

  // Check if the group's nodes (and their wrappers) account for every
  // child of the given list — i.e., the group IS the entire list content.
  #groupSpansEntireList(group, list) {
    const memberKeys = new Set()
    for (const { node, wrapper } of group) {
      memberKeys.add(node.getKey())
      if (wrapper) memberKeys.add(wrapper.getKey())
    }
    for (const child of list.getChildren()) {
      if (!memberKeys.has(child.getKey())) return false
    }
    return true
  }

  // Promote a list item out of its current list to the parent level.
  // Nested lists: move to the parent list (one level up).
  // Root-level lists:
  //   - Wrapped blocks (entered via block movement): extract and exit as standalone
  //   - Regular list items: wrap in a new sibling ListNode (blocked at doc start)
  #promoteListItem(node, currentList, isDown) {
    const listParent = currentList.getParent()

    if ($isListItemNode(listParent)) {
      // Nested list: move to parent list level.
      const parentList = listParent.getParent()
      const isTargetRootLevel = parentList && !$isListItemNode(parentList.getParent())

      // Wrapped blocks skip root level entirely — they either nest into
      // the adjacent root-level sibling or exit the list as standalone elements.
      if (isTargetRootLevel && this.#wrappedOrigins.isWrapped(node)) {
        this.#promoteWrappedBlockThroughRoot(node, currentList, listParent, parentList, isDown)
        return
      }

      // Standard promotion: move to parent list level.
      // Capture the node's children wrapper BEFORE moving.
      const ownWrapper = this.#getOwnStructuralWrapper(node)

      // Standard promotion: move to parent list level (one level up).
      // The listParent is the structural wrapper ListItemNode. When moving
      // UP, go before the TEXT ListItemNode that precedes the wrapper.
      if (isDown) {
        listParent.insertAfter(node)
      } else {
        const textSibling = listParent.getPreviousSibling()
        if (textSibling && $isListItemNode(textSibling)) {
          textSibling.insertBefore(node)
        } else {
          listParent.insertBefore(node)
        }
      }
      if (ownWrapper) node.insertAfter(ownWrapper)
      this.#cleanupEmptyList(currentList)
    } else {
      // Root-level list boundary.

      // Movement-wrapped items only: extract content to standalone and
      // place beside the list. These drifted in via arrow movement; the
      // user wants them out as plain blocks.
      // User-wrapped items fall through to the "regular list item" path
      // below so they stay wrapped in a new sibling list — only Shift+Tab
      // explicitly outdents them to standalone.
      if (this.#wrappedOrigins.isWrapped(node) && !this.#wrappedOrigins.isUser(node)) {
        // Carry children out with the block
        const ownWrapper = this.#getOwnStructuralWrapper(node)
        let childrenList = null
        if (ownWrapper) {
          const innerList = ownWrapper.getChildren().find(c => $isListNode(c))
          if (innerList) {
            innerList.remove()
            childrenList = innerList
          }
          ownWrapper.remove()
        }

        const extracted = this.#extractWrappedContent(node)
        if (extracted) {
          const nodeKey = node.getKey()
          node.remove()
          this.#cleanupEmptyList(currentList)
          if (isDown) {
            currentList.insertAfter(extracted)
            if (childrenList) extracted.insertAfter(childrenList)
          } else {
            currentList.insertBefore(extracted)
            if (childrenList) extracted.insertAfter(childrenList)
          }
          this.#updateKeyAfterUnwrap(nodeKey, extracted.getKey())
          return
        }
      }

      // Regular list items and user-wrapped items: wrap in a new sibling
      // list and move it. Can't break out upward if at document start.
      if (!isDown && !currentList.getPreviousSibling()) return

      // Carry the node's children (structural wrapper) along when promoting
      const ownWrapper = this.#getOwnStructuralWrapper(node)

      const newList = $createListNode(currentList.getListType())
      newList.append(node)
      if (ownWrapper) {
        newList.append(ownWrapper)
      }

      if (isDown) {
        currentList.insertAfter(newList)
      } else {
        currentList.insertBefore(newList)
      }
      this.#cleanupEmptyList(currentList)
      this.#moveTopLevelBlock(newList, isDown ? "down" : "up")
    }
  }

  // When a wrapped block promotes from a nested list and the target is the
  // root-level list, skip root level: nest directly into the adjacent
  // root-level sibling (continuing traversal) or exit the list entirely.
  #promoteWrappedBlockThroughRoot(node, currentList, wrapper, rootList, isDown) {
    const ownerItem = wrapper.getPreviousSibling()
    let targetSibling = null

    if (isDown) {
      // Look for the next real item after the wrapper at root level
      let candidate = wrapper.getNextSibling()
      while (candidate && $isListItemNode(candidate) && $isStructuralWrapper(candidate)) {
        candidate = candidate.getNextSibling()
      }
      if (candidate && $isListItemNode(candidate) && !$isStructuralWrapper(candidate)) {
        targetSibling = candidate
      }
    } else {
      // Look for the prev real item before the owner at root level
      if (ownerItem && $isListItemNode(ownerItem) && !$isStructuralWrapper(ownerItem)) {
        let candidate = ownerItem.getPreviousSibling()
        while (candidate && $isListItemNode(candidate) && $isStructuralWrapper(candidate)) {
          candidate = candidate.getPreviousSibling()
        }
        if (candidate && $isListItemNode(candidate) && !$isStructuralWrapper(candidate)) {
          targetSibling = candidate
        }
      }
    }

    // Will the source wrapper be empty after the node moves out?
    const shouldDestroyWrapper = this.#countRealItems(currentList) <= 1
    const wrapperKey = shouldDestroyWrapper ? wrapper.getKey() : null

    // Don't nest under a sibling that's also being moved as part of the
    // same selection group — they should stay at the same level.
    if (targetSibling && this.#selectedBlockKeys.has(targetSibling.getKey())) {
      targetSibling = null
    }

    if (targetSibling) {
      // Nest under the adjacent root-level sibling (skip root level).
      // #nestListItemUnderSibling handles atomic move and cleanup.
      this.#nestListItemUnderSibling(node, targetSibling, rootList, isDown)
    } else if (this.#wrappedOrigins.isUser(node)) {
      // User-wrapped: exit to a NEW root-level list beside the source,
      // carrying the structural wrapper (and its nested children) intact.
      // The item stays a wrapped list item — only Shift+Tab unwraps.
      const ownWrapper = this.#getOwnStructuralWrapper(node)
      if (ownWrapper) ownWrapper.remove()
      node.remove()

      const newList = $createListNode(rootList.getListType())
      newList.append(node)
      if (ownWrapper) newList.append(ownWrapper)

      if (isDown) rootList.insertAfter(newList)
      else rootList.insertBefore(newList)
    } else {
      // Movement-wrapped: extract content to standalone and drop beside
      // the list. The user was just moving a non-list block through — get
      // it out the other side unwrapped.
      const ownWrapper = this.#getOwnStructuralWrapper(node)
      let childrenList = null
      if (ownWrapper) {
        const innerList = ownWrapper.getChildren().find(c => $isListNode(c))
        if (innerList) {
          innerList.remove()
          childrenList = innerList
        }
        ownWrapper.remove()
      }

      const extracted = this.#extractWrappedContent(node)
      if (extracted) {
        const nodeKey = node.getKey()
        node.remove()
        if (isDown) {
          rootList.insertAfter(extracted)
        } else {
          rootList.insertBefore(extracted)
        }
        if (childrenList) extracted.insertAfter(childrenList)
        this.#updateKeyAfterUnwrap(nodeKey, extracted.getKey())
      } else {
        // Fallback: place at root level if extraction fails
        if (isDown) {
          wrapper.insertAfter(node)
        } else {
          if (ownerItem && $isListItemNode(ownerItem)) {
            ownerItem.insertBefore(node)
          } else {
            wrapper.insertBefore(node)
          }
        }
      }
    }

    // Destroy the structural wrapper directly (not via the list key).
    // This removes the wrapper, its nested list, and any Lexical-added
    // placeholder items in one shot.
    if (wrapperKey) {
      this.#forceDestroyWrapper(wrapperKey)
    }
  }

  // Extract the wrapped content from a ListItemNode that entered via block
  // movement. Returns a standalone node ready for root-level placement, or null.
  // - Non-paragraph blocks (h2, code, etc.): detaches and returns the child
  // - Paragraphs (merged by Lexical into the <li>): creates a new ParagraphNode
  //   and moves the <li>'s children into it
  // - Regular list items (not wrapped): returns null
  // For non-paragraph blocks: always extracts (content heuristic).
  // For paragraph-content items: only extracts if tracked as wrapped.
  // Returns a standalone node or null.
  #extractWrappedContent(listItemNode) {
    const children = listItemNode.getChildren()
    if (children.length === 0) return null

    // Non-paragraph block child (heading, code, table, HR, etc.) — always extract.
    // Matches both ElementNodes (heading, code, table) and DecoratorNodes (HR, images).
    // Pass preserveEmptyParent=true so Lexical's $removeNode doesn't cascade-
    // remove the now-empty listItem (and its ancestor list) — callers still
    // need those parent references to place the extracted content.
    if (children.length === 1
        && ($isElementNode(children[0]) || $isDecoratorNode(children[0]))
        && !$isListNode(children[0]) && !$isParagraphNode(children[0])) {
      const child = children[0]
      child.remove(true)
      return child
    }

    // Paragraph case: Lexical merges <p> content into <li> as raw inline
    // nodes (TextNode, spans). Reconstruct a ParagraphNode from them.
    // Only for wrapped blocks (not regular list items).
    if (this.#wrappedOrigins.isWrapped(listItemNode)) {
      // Check if there's still a ParagraphNode child
      for (const child of children) {
        if ($isParagraphNode(child)) {
          child.remove(true)
          return child
        }
      }
      // No ParagraphNode — content is inline. Wrap in a new paragraph.
      const hasContent = children.some(c => !$isListNode(c))
      if (hasContent) {
        const paragraph = $createParagraphNode()
        for (const child of [ ...listItemNode.getChildren() ]) {
          if (!$isListNode(child)) {
            paragraph.append(child)
          }
        }
        return paragraph.getChildrenSize() > 0 ? paragraph : null
      }
    }

    return null
  }

  // Legacy alias used by #promoteListItem
  #unwrapIfNonListContent(listItemNode) {
    return this.#extractWrappedContent(listItemNode)
  }

  // Move a top-level block. When the adjacent sibling is a ListNode:
  //   ListNode (regular list items): merge items as siblings at the boundary
  //   Non-list block: wrap in ListItemNode and nest under first/last item
  #moveTopLevelBlock(node, direction) {
    const isDown = direction === "down"
    const sibling = isDown ? node.getNextSibling() : node.getPreviousSibling()

    if (!sibling) return

    // Decorator nodes (HR, images): Lexical keeps separator paragraphs between
    // adjacent decorators. When moving a decorator, skip over any empty separator
    // paragraphs to reach the real target position.
    // If the target is a ListNode, fall through to the list-handling logic below.
    if ($isDecoratorNode(node)) {
      let target = sibling
      // Skip empty separator paragraphs between decorator nodes
      while (target && $isParagraphNode(target) && target.getTextContentSize() === 0) {
        const beyond = isDown ? target.getNextSibling() : target.getPreviousSibling()
        if (beyond) {
          target = beyond
        } else {
          break
        }
      }
      if (!$isListNode(target)) {
        if (isDown) {
          target.insertAfter(node)
        } else {
          target.insertBefore(node)
        }
        return
      }
      // target is a ListNode — fall through to list handling below
    }

    // When moving an empty paragraph adjacent to a decorator node (HR, image),
    // swap the decorator over the paragraph instead. This prevents Lexical from
    // re-inserting a separator paragraph (which makes the move appear to fail).
    if ($isParagraphNode(node) && node.getTextContentSize() === 0 && $isDecoratorNode(sibling)) {
      if (isDown) {
        node.insertBefore(sibling)
      } else {
        node.insertAfter(sibling)
      }
      return
    }

    if ($isListNode(sibling)) {
      if ($isListNode(node)) {
        // List merging into adjacent list: extract items and insert as
        // siblings at the boundary. Regular list items enter at the same
        // level, not nested.
        const items = [ ...node.getChildren() ]

        if (isDown) {
          const firstItem = this.#findFirstRealItem(sibling)
          for (let i = items.length - 1; i >= 0; i--) {
            if (firstItem) {
              firstItem.insertBefore(items[i])
            } else {
              sibling.append(items[i])
            }
          }
        } else {
          for (const item of items) {
            sibling.append(item)
          }
        }

        node.remove()
      } else {
        // Non-list block entering a list: wrap in a ListItemNode and insert
        // as a sibling at the list's top level (next to the first/last real
        // item). A subsequent movement in the same direction will then nest
        // via the normal #moveListItem path. This two-phase entry matches
        // the multi-block group path (#moveGroupIntoList) and avoids
        // yanking the user one nesting level deep on a single keypress.
        const oldKey = node.getKey()
        const listItem = $createListItemNode()
        listItem.append(node)

        const targetItem = isDown
          ? this.#findFirstRealItem(sibling)
          : this.#findLastRealItem(sibling)

        if (targetItem) {
          if (isDown) {
            targetItem.insertBefore(listItem)
          } else {
            targetItem.insertAfter(listItem)
          }
        } else {
          sibling.append(listItem)
        }

        // Track this as a movement-wrapped item — it drifted into a list
        // via arrow movement, so it should auto-unwrap on the way out.
        this.#wrappedOrigins.trackMovement(listItem.getKey())

        // Update selection to track the wrapper ListItemNode
        const newKey = listItem.getKey()
        if (this.#selectedBlockKeys.has(oldKey)) {
          this.#selectedBlockKeys.delete(oldKey)
          this.#selectedBlockKeys.add(newKey)
          if (this.#anchorKey === oldKey) this.#anchorKey = newKey
          if (this.#focusKey === oldKey) this.#focusKey = newKey
        }

        // Inherit color from the parent list item if it has one
        this.#inheritParentHighlight(listItem)
      }
    } else {
      if (isDown) {
        sibling.insertAfter(node)
      } else {
        sibling.insertBefore(node)
      }
    }
  }

  #findFirstRealItem(listNode) {
    for (const child of listNode.getChildren()) {
      if ($isListItemNode(child) && !$isStructuralWrapper(child)) {
        return child
      }
    }
    return null
  }

  #findLastRealItem(listNode) {
    const children = listNode.getChildren()
    for (let i = children.length - 1; i >= 0; i--) {
      if ($isListItemNode(children[i]) && !$isStructuralWrapper(children[i])) {
        return children[i]
      }
    }
    return null
  }

  // Update selection tracking when a wrapper ListItemNode is unwrapped
  // back to its standalone content node.
  #updateKeyAfterUnwrap(oldKey, newKey) {
    this.#wrappedOrigins.untrack(oldKey)
    if (this.#selectedBlockKeys.has(oldKey)) {
      this.#selectedBlockKeys.delete(oldKey)
      this.#selectedBlockKeys.add(newKey)
    }
    if (this.#anchorKey === oldKey) this.#anchorKey = newKey
    if (this.#focusKey === oldKey) this.#focusKey = newKey
  }

  // Walk up from a node to find the highest ancestor that would become empty
  // if we delete this node. For a wrapped block in a nested list like:
  //   li(structural) → ul → li(structural) → ul → li(wraps HR) → figure
  // If the inner li is the only real item in its ul, and that ul is the only
  // child of its structural wrapper li, we can delete the outermost wrapper
  // instead — removing the entire empty chain in one shot.
  #findHighestRemovableAncestor(node, root) {
    let target = node

    while (true) {
      const parent = target.getParent()
      if (!parent || parent === root) break

      if ($isListNode(parent)) {
        // Is this the only real (non-structural) item in the list?
        if (this.#countRealItems(parent) <= 1) {
          // The list would be empty — check if we can remove its wrapper too
          const wrapper = parent.getParent()
          if (wrapper && $isListItemNode(wrapper) && wrapper !== root) {
            target = wrapper
            continue // keep walking up
          }
          // List is a root child — remove the whole list
          target = parent
        }
        break
      } else if ($isListItemNode(parent)) {
        // Node is content inside a list item — can we remove the whole item?
        // Only if it has no other meaningful content (just this node)
        const siblings = parent.getChildren().filter(c => !$isListNode(c))
        if (siblings.length <= 1) {
          target = parent
          continue // keep walking up
        }
        break
      } else {
        break
      }
    }

    return target
  }

  // Walk up the tree from a parent node after its child was deleted,
  // removing any empty containers: ListItemNode → ListNode → structural wrapper
  #cleanupEmptyList(listNode) {
    if (!$isListNode(listNode)) return

    // Resolve the latest version — Lexical's copy-on-write creates new
    // instances when the tree is mutated, so our reference may be stale.
    const latest = $getNodeByKey(listNode.getKey())
    if (!latest || !$isListNode(latest)) return
    listNode = latest

    // If the list has no parent, it was already removed
    if (!listNode.getParent()) return

    // Prune ONLY structural wrappers that became empty (no list children).
    // Do NOT remove regular items with empty text — those may be user-created
    // or the previous sibling bullet that happens to have no text.
    for (const child of [ ...listNode.getChildren() ]) {
      if ($isListItemNode(child) && $isStructuralWrapper(child)
          && child.getChildren().every(c => $isListNode(c) && c.getChildrenSize() === 0)) {
        child.remove()
      }
    }

    // Clean up lists that are empty OR only contain empty structural wrappers.
    // Use getTextContentSize to check ALL descendants (including nested wrappers
    // that contain real content like headings) — countRealItems only checks
    // direct children and misses content inside structural wrappers.
    if (listNode.getTextContentSize() > 0) return

    // Remove any leftover structural wrappers
    for (const child of listNode.getChildren()) {
      child.remove()
    }

    // If the list is inside a structural wrapper, destroy the wrapper
    // (which takes the list with it). Otherwise just remove the list.
    const parent = listNode.getParent()
    if ($isListItemNode(parent) && $isStructuralWrapper(parent)) {
      this.#forceDestroyWrapper(parent.getKey())
    } else {
      listNode.remove()
    }
  }

  // Walk all lists in the document and merge adjacent wrappers at every level.
  // Merge adjacent structural wrappers in a list. After outdent splits a list,
  // re-indenting can leave separate wrappers that should be one. This combines
  // them so parent→child selection traversal works correctly.
  #mergeAdjacentWrappers(listNode) {
    if (!$isListNode(listNode)) return
    const latest = $getNodeByKey(listNode.getKey())
    if (!latest || !$isListNode(latest)) return

    const children = [ ...latest.getChildren() ]
    for (let i = 0; i < children.length - 1; i++) {
      const current = children[i]
      const next = children[i + 1]
      if (!$isListItemNode(current) || !$isListItemNode(next)) continue
      if (!$isStructuralWrapper(current) || !$isStructuralWrapper(next)) continue

      const currentList = current.getChildren().find(c => $isListNode(c))
      const nextList = next.getChildren().find(c => $isListNode(c))
      if (currentList && nextList) {
        for (const child of [ ...nextList.getChildren() ]) {
          currentList.append(child)
        }
        next.remove()
      }
    }
  }

  // Unconditionally destroy a structural wrapper ListItemNode and everything
  // inside it (nested lists, placeholder items, etc.) by key.
  #forceDestroyWrapper(wrapperKey) {
    const wrapper = $getNodeByKey(wrapperKey)
    if (!wrapper || !$isListItemNode(wrapper)) return
    if (!wrapper.getParent()) return // already removed
    wrapper.remove()
  }

  // -- Format/highlight command interception ----------------------------------

  // Intercept FORMAT_TEXT_COMMAND in block-select mode — toolbar buttons
  // dispatch this directly but there's no Lexical selection to apply to.
  // We handle it by creating a temporary selection before re-dispatching.
  #registerBlockSelectFormatHandler() {
    this.#cleanupFns.push(
      this.editor.registerCommand(FORMAT_TEXT_COMMAND, (format) => {
        if (!this.isBlockSelectMode) return false
        // Don't re-dispatch — directly create selection and apply the format
        // within a single editor.update() to avoid recursive command dispatch.
        // Save scroll position — selectStart() causes Lexical to set DOM
        // selection which triggers browser scroll-into-view.
        const scrollY = window.scrollY
        this.editor.update(() => {
          const keys = [ ...this.#selectedBlockKeys ]
          if (keys.length === 0) return
          const firstNode = $getNodeByKey(keys[0])
          const lastNode = $getNodeByKey(keys[keys.length - 1])
          if (!firstNode) return
          firstNode.selectStart()
          const selection = $getSelection()
          if ($isRangeSelection(selection) && lastNode) {
            const lastDescendant = lastNode.getLastDescendant()
            if (lastDescendant) {
              const endOffset = $isElementNode(lastDescendant)
                ? lastDescendant.getChildrenSize()
                : lastDescendant.getTextContentSize()
              selection.focus.set(lastDescendant.getKey(), endOffset, $isElementNode(lastDescendant) ? "element" : "text")
            }
          }
          selection?.formatText(format)
          $setSelection(null)
        })
        // Restore scroll after Lexical's DOM reconciliation
        queueMicrotask(() => window.scrollTo(window.scrollX, scrollY))
        this.root?.focus({ preventScroll: true })
        requestAnimationFrame(() => this.#syncSelectionClasses())
        return true
      }, COMMAND_PRIORITY_CRITICAL),

      // Intercept highlight commands so the toolbar dropdown works in
      // block-select mode (where there's no Lexical range selection).
      this.editor.registerCommand(TOGGLE_HIGHLIGHT_COMMAND, (styles) => {
        if (!this.isBlockSelectMode) return false

        for (const [ prop, value ] of Object.entries(styles || {})) {
          if (value) {
            this.#applyColorToSelectedBlocks(prop, value)
          } else {
            this.#applyColorToSelectedBlocks(null, null)
          }
        }

        this.root?.focus({ preventScroll: true })
        return true
      }, COMMAND_PRIORITY_CRITICAL),

      this.editor.registerCommand(REMOVE_HIGHLIGHT_COMMAND, () => {
        if (!this.isBlockSelectMode) return false
        this.#applyColorToSelectedBlocks(null, null)
        this.root?.focus({ preventScroll: true })
        return true
      }, COMMAND_PRIORITY_CRITICAL)
    )
  }

  // -- Highlight clear on Enter -----------------------------------------------

  // Clear highlight color when Enter creates a new line. Skips when the slash
  // menu is open (Enter selects a menu item, not a new line).
  #registerHighlightClearOnEnter() {
    const editorElement = this.editorElement
    this.#cleanupFns.push(
      this.editor.registerCommand(KEY_ENTER_COMMAND, () => {
        if (editorElement.querySelector("lexxy-prompt[open]")) return false
        setTimeout(() => this.#clearHighlightOnNewBlock(), 0)
        return false
      }, COMMAND_PRIORITY_CRITICAL)
    )
  }

  #clearHighlightOnNewBlock() {
    this.editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      let anchor = selection.anchor.getNode()

      if (!$isTextNode(anchor)) {
        const firstChild = anchor.getFirstChild?.()
        if ($isTextNode(firstChild)) {
          anchor = firstChild
        } else {
          // No text node — clear selection style and ListItemNode textStyle
          // so new text won't inherit highlight color.
          const checkStyle = selection.style ||
            ($isListItemNode(anchor) ? anchor.getTextStyle() : "")
          if (checkStyle && extractHighlightFromCSS(checkStyle)) {
            if (this.#shouldRetainHighlightFromParent(anchor, checkStyle)) {
              // Retaining parent color — set the <li> element style so the
              // bullet marker is colored immediately (the transform can't
              // detect color from an empty item with no text nodes yet).
              if ($isListItemNode(anchor)) {
                const highlight = extractHighlightFromCSS(checkStyle)
                if (highlight?.color) {
                  anchor.setStyle(mergeHighlightIntoCSS(anchor.getStyle(), { color: highlight.color }))
                }
              }
              return
            }
            const cleared = removeHighlightFromCSS(checkStyle) ?? ""
            selection.setStyle(cleared)
            if ($isListItemNode(anchor)) {
              anchor.setTextStyle(removeHighlightFromCSS(anchor.getTextStyle()) ?? "")
            }
          }
          // Always try to inherit parent color — handles cases where the new
          // item has no highlight to clear (e.g., exiting a code block) but
          // is nested under a colored parent.
          this.#inheritFromParentListItem(anchor)
          return
        }
      }

      // eslint-disable-next-line no-misleading-character-class
      const text = anchor.getTextContent().replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
      if (text.length > 0) return

      const style = anchor.getStyle()
      if (extractHighlightFromCSS(style)) {
        // Has highlight — check if parent retains it
        if (this.#shouldRetainHighlightFromParent(anchor, style)) {
          let listItem = anchor.getParent()
          while (listItem && !$isListItemNode(listItem)) listItem = listItem.getParent()
          if (listItem) {
            const highlight = extractHighlightFromCSS(style)
            if (highlight?.color) {
              listItem.setStyle(mergeHighlightIntoCSS(listItem.getStyle(), { color: highlight.color }))
            }
          }
          return
        }
        const cleared = removeHighlightFromCSS(style)
        anchor.setStyle(cleared ?? "")
        selection.setStyle(cleared ?? "")
      }

      // Always try to inherit parent color after any clearing/checking.
      this.#inheritFromParentListItem(anchor)
    })
  }

  // Walk up from any node to find the containing ListItemNode and apply
  // parent highlight inheritance.
  #inheritFromParentListItem(node) {
    let listItem = node
    while (listItem && !$isListItemNode(listItem)) listItem = listItem.getParent()
    if (listItem) this.#inheritParentHighlight(listItem)
  }

  // Pressing Enter inside a wrapped block (heading, table, etc. in a list item)
  // creates a new empty list item below as a sibling — not a paragraph inside
  // the same list item.
  //
  // Handles KEY_ENTER_COMMAND (not INSERT_PARAGRAPH_COMMAND) at CRITICAL priority.
  // Calls event.preventDefault() to stop the browser from firing beforeinput,
  // then defers node creation to a queueMicrotask — a clean, separate update
  // cycle. This avoids two problems:
  //   1. KEY_ENTER_COMMAND runs nested inside KEY_DOWN_COMMAND's $beginUpdate,
  //      so creating nodes here would have their selection invalidated by
  //      post-transform validation.
  //   2. INSERT_PARAGRAPH_COMMAND handlers that modify nodes can leave the
  //      committed state with an invalid selection, causing the NEXT keydown's
  //      $beginUpdate to throw "selection has been lost."
  //
  // Must be registered BEFORE #registerHighlightClearOnEnter so that returning
  // true here prevents the highlight clear setTimeout from being scheduled.
  #registerEnterOnWrappedBlock() {
    this.#cleanupFns.push(
      this.editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
        // Don't intercept Enter when a prompt menu (slash commands, turn-into,
        // etc.) or block actions menu is open — Enter selects the menu item.
        // Option+Enter falls through to Lexical's default (paragraph inside the LI).
        if (this.editorElement.hasOpenPrompt || this.#isBlockActionsMenuOpen()) return false
        if (event.altKey) return false

        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        // Walk up to find the containing list item, but bail if we're
        // inside a code block or table (they handle Enter internally)
        let current = selection.anchor.getNode()
        let listItem = null
        while (current) {
          if ($isCodeNode(current)) return false
          if ($isElementNode(current) && current.getType()?.includes("table")) return false
          if ($isListItemNode(current)) { listItem = current; break }
          current = current.getParent()
        }
        if (!listItem) return false

        // Only act on wrapped blocks (heading, quote, etc. in a list item)
        if (!this.#wrappedOrigins.isWrapped(listItem)) return false

        // Prevent browser from firing beforeinput/insertParagraph
        event.preventDefault()

        // Save key for deferred node creation — don't create nodes here
        // because we're nested inside KEY_DOWN_COMMAND's $beginUpdate.
        const listItemKey = listItem.getKey()

        queueMicrotask(() => {
          this.editor.update(() => {
            const li = $getNodeByKey(listItemKey)
            if (!li || !$isListItemNode(li)) return

            // Create a bare ListItemNode — no ParagraphNode wrapper.
            // Lexical's list model expects inline content directly in list
            // items; ParagraphNode children get stripped by transforms.
            const newItem = $createListItemNode()

            // Insert after the structural wrapper if one exists (so we don't
            // break the wrapped item ↔ children relationship), otherwise
            // insert directly after the list item.
            const ownWrapper = this.#getOwnStructuralWrapper(li)
            if (ownWrapper) {
              ownWrapper.insertAfter(newItem)
            } else {
              li.insertAfter(newItem)
            }

            newItem.select()
          })
        })

        return true // consume — prevent highlight clear and default Enter
      }, COMMAND_PRIORITY_CRITICAL)
    )
  }

  // After indent, if the new parent is uniformly highlighted, apply its color
  // to the indented node so children inherit their parent's color.
  #inheritParentHighlight(node) {
    const parent = node.getParent()
    if (!$isListNode(parent)) return

    // Find the text item that "owns" this nested list (the item before the
    // structural wrapper that contains this list)
    const wrapper = parent.getParent()
    if (!$isListItemNode(wrapper)) return
    const textItem = wrapper.getPreviousSibling()
    if (!textItem || !$isListItemNode(textItem)) return

    // Check if the parent item has highlight color. Compare only the
    // highlight properties (color/background-color), not full style strings,
    // so bold/italic/etc. differences don't prevent inheritance.
    const textNodes = []
    function collectText(n) {
      if ($isTextNode(n)) textNodes.push(n)
      else if (n.getChildren) n.getChildren().forEach(collectText)
    }
    textItem.getChildren().forEach(c => { if (!$isListNode(c)) collectText(c) })

    if (textNodes.length === 0) return
    const rawStyle = textNodes[0].getStyle()
    // Parse highlight properties directly from the raw CSS string.
    // getStyleObjectFromCSS can fail to parse var() values in some build
    // configurations, so we extract color/background-color manually.
    const firstHighlight = extractHighlightFromCSS(rawStyle)
    if (!firstHighlight) return

    // Verify all parent text nodes share the same highlight colors
    const allMatch = textNodes.every(t => {
      const h = extractHighlightFromCSS(t.getStyle())
      return h &&
        (h.color || "") === (firstHighlight.color || "") &&
        (h["background-color"] || "") === (firstHighlight["background-color"] || "")
    })
    if (!allMatch) return

    // Apply the parent's color to existing text nodes in the child
    const childTextNodes = this.#getAllTextNodesForItem(node)

    for (const textNode of childTextNodes) {
      const newStyle = mergeHighlightIntoCSS(textNode.getStyle(), firstHighlight)
      textNode.setStyle(newStyle)
    }

    // Always set the ListItemNode text style and selection style so that
    // continued typing inherits the parent's color. The bullet marker color
    // is handled by the #registerBulletMarkerColorSync transform.
    if ($isListItemNode(node)) {
      node.setTextStyle(mergeHighlightIntoCSS(node.getTextStyle(), firstHighlight))
    }
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      selection.setStyle(mergeHighlightIntoCSS(selection.style, firstHighlight))
    }
  }

  // When a highlight color is applied to a parent list item, propagate it to
  // all children in the structural wrapper so the whole subtree matches.
  #registerHighlightPropagation() {
    this.#cleanupFns.push(
      this.editor.registerCommand(TOGGLE_HIGHLIGHT_COMMAND, (styles) => {
        // Let the highlight command apply first, then propagate
        setTimeout(() => this.#propagateHighlightToChildren(styles), 0)
        return false // don't consume — let the highlight extension handle it
      }, COMMAND_PRIORITY_CRITICAL)
    )
  }

  #propagateHighlightToChildren(styles) {
    this.editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      // Find the list item containing the selection
      const listItem = getListItemNode(selection.anchor.getNode())
      if (!listItem) return

      // Check if this item has children (structural wrapper)
      const wrapper = this.#getOwnStructuralWrapper(listItem)
      if (!wrapper) return

      // Check if the ENTIRE parent item is uniformly this color
      // (not just a partial selection)
      const parentTextNodes = []
      listItem.getChildren().forEach(c => {
        if (!$isListNode(c)) this.#collectTextNodes(c, parentTextNodes)
      })
      if (parentTextNodes.length === 0) return

      const parentStyle = parentTextNodes[0].getStyle()
      if (!parentTextNodes.every(t => t.getStyle() === parentStyle)) return

      // Apply the same color to all descendant text nodes
      const childTextNodes = []
      this.#collectAllDescendantTextNodes(wrapper, childTextNodes)
      const parentStyles = getStyleObjectFromCSS(parentStyle)

      for (const textNode of childTextNodes) {
        const existing = getStyleObjectFromCSS(textNode.getStyle() || "")
        if (parentStyles.color) existing.color = parentStyles.color
        else delete existing.color
        if (parentStyles["background-color"]) existing["background-color"] = parentStyles["background-color"]
        else delete existing["background-color"]
        textNode.setStyle(getCSSFromStyleObject(existing))
      }
    })
  }

  // Collect all text nodes for a block item, including any children carried
  // by its structural wrapper. Skips code blocks (they have their own syntax
  // colors). This is the primary entry point — use instead of calling
  // #collectTextNodes + #getOwnStructuralWrapper manually.
  #getAllTextNodesForItem(node) {
    const result = []
    this.#collectTextNodes(node, result)
    const ownWrapper = $isListItemNode(node) ? this.#getOwnStructuralWrapper(node) : null
    if (ownWrapper) this.#collectAllDescendantTextNodes(ownWrapper, result)
    return result
  }

  #collectTextNodes(node, result) {
    if ($isCodeNode(node)) return
    if ($isTextNode(node)) result.push(node)
    else if (node.getChildren) node.getChildren().forEach(c => this.#collectTextNodes(c, result))
  }

  #collectAllDescendantTextNodes(node, result) {
    if ($isCodeNode(node)) return
    if ($isTextNode(node)) { result.push(node); return }
    if (node.getChildren) {
      for (const child of node.getChildren()) {
        this.#collectAllDescendantTextNodes(child, result)
      }
    }
  }

  // Public: apply parent highlight inheritance to a node after drop.
  inheritParentHighlight(nodeKey) {
    this.editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (node && $isListItemNode(node)) {
        this.#inheritParentHighlight(node)
      }
    })
  }

  // After keyboard move: if the node is now inside a uniformly highlighted
  // parent, inherit the color (saving the original). If moved OUT of a
  // highlighted parent, restore the original color.
  #applyOrRestoreParentHighlight(node) {
    const parentColor = this.#getParentHighlight(node)

    if (parentColor) {
      // Entering a highlighted parent — save original and apply parent color
      // to node AND all its descendants
      const textNodes = this.#getAllTextNodesForItem(node)
      for (const t of textNodes) {
        const key = t.getKey()
        if (!this.#savedHighlightStyles.has(key)) {
          this.#savedHighlightStyles.set(key, t.getStyle() || "")
        }
        const existing = getStyleObjectFromCSS(t.getStyle() || "")
        const parentStyles = getStyleObjectFromCSS(parentColor)
        if (parentStyles.color) existing.color = parentStyles.color
        if (parentStyles["background-color"]) existing["background-color"] = parentStyles["background-color"]
        t.setStyle(getCSSFromStyleObject(existing))
      }
    } else {
      // No highlighted parent — restore ONLY styles that were changed by
      // inheritance (saved in the map). Items that had their own color
      // before being moved are not in the map, so they keep their color.
      const textNodes = this.#getAllTextNodesForItem(node)
      for (const t of textNodes) {
        const key = t.getKey()
        if (this.#savedHighlightStyles.has(key)) {
          t.setStyle(this.#savedHighlightStyles.get(key))
          this.#savedHighlightStyles.delete(key)
        }
      }
    }
  }

  // Check if the node is inside a uniformly highlighted ancestor.
  // Walks up through structural wrappers to find the nearest content item
  // with highlight styles. Skips code blocks (they don't carry color).
  // Returns the style string if found, null otherwise.
  //
  // maxLevels controls how far up the tree to look:
  //   Infinity (default) — walk all ancestors until a match or root
  //   1                  — only check the immediate parent
  #getParentHighlight(node, maxLevels = Infinity) {
    let currentList = node.getParent()
    if (!$isListNode(currentList) && $isListItemNode(node)) currentList = node.getParent()
    let level = 0

    while ($isListNode(currentList) && level < maxLevels) {
      level++
      const wrapper = currentList.getParent()
      if (!$isListItemNode(wrapper)) break

      const textItem = wrapper.getPreviousSibling()
      if (!textItem || !$isListItemNode(textItem)) break

      // Collect text nodes from the parent item (skipping nested lists)
      const textNodes = []
      textItem.getChildren().forEach(c => { if (!$isListNode(c)) this.#collectTextNodes(c, textNodes) })

      if (textNodes.length > 0) {
        const style = textNodes[0].getStyle()
        if (!style || !hasHighlightStyles(style)) return null

        // Verify all parent text nodes share the same highlight
        const allMatch = textNodes.every(t => this.#highlightColorsMatch(style, t.getStyle()))
        return allMatch ? style : null
      }

      // No text nodes (code block or empty) — walk up to grandparent
      currentList = wrapper.getParent()
    }

    return null
  }

  #highlightColorsMatch(style1, style2) {
    const s1 = extractHighlightFromCSS(style1) || {}
    const s2 = extractHighlightFromCSS(style2) || {}
    return (s1.color || "") === (s2.color || "") &&
      (s1["background-color"] || "") === (s2["background-color"] || "")
  }

  // Check if a node is inside a list item whose immediate parent has the
  // same highlight color — if so, Enter should retain the color.
  #shouldRetainHighlightFromParent(node, currentStyle) {
    const listItem = getListItemNode(node)
    if (!listItem) return false
    const parentColor = this.#getParentHighlight(listItem, 1)
    return parentColor !== null && this.#highlightColorsMatch(currentStyle, parentColor)
  }

  // -- Wrapped block indent/outdent -------------------------------------------

  // When Tab/Shift+Tab fires inside a wrapped block (heading, blockquote, etc.
  // that was moved into a list), Lexical's default handler indents the CONTENT
  // (e.g., adds indent to the heading). Instead, move the entire list item —
  // the same as nesting/promoting a regular list item.
  // In normal mode, intercept Tab only for wrapped blocks (headings, blockquotes,
  // etc.) — Lexical's default handler adds padding to the content instead of
  // nesting the list item. Regular items use Lexical's default re-parenting.
  #registerWrappedBlockIndentHandler() {
    const handleIndent = (isOutdent) => {
      if (this.#mode === "block-select") return false

      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return false

      const anchorNode = selection.anchor.getNode()
      let current = anchorNode
      while (current) {
        if ($isListItemNode(current)) {
          const children = current.getChildren()
          const hasNonTextBlock = children.some(c =>
            $isElementNode(c) && !$isListNode(c) && !$isParagraphNode(c)
          )
          if (hasNonTextBlock) {
            let result
            if (isOutdent) {
              result = this.#outdentWrappedBlock(current, false)
            } else {
              result = this.#indentWrappedBlock(current, false)
            }
            if (result) {
              // Double-RAF: first waits for Lexical's DOM reconciliation,
              // second ensures layout is computed before repositioning
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  this.#dragAndDrop?.repositionHandle()
                  this.#syncBulletOffsets()
                })
              })
            }
            return result
          }
          break
        }
        current = current.getParent()
      }
      return false
    }

    // Schedule handle reposition after indent/outdent. These may not run if
    // the Lexical extension's CRITICAL handler consumes first, but the wrapped
    // block handler at HIGH also schedules repositioning as a fallback.
    // eslint-disable-next-line func-style
    const scheduleReposition = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.#dragAndDrop?.repositionHandle()
          this.#syncBulletOffsets()
        })
      })
      return false
    }

    this.#cleanupFns.push(
      this.editor.registerCommand(INDENT_CONTENT_COMMAND, scheduleReposition, COMMAND_PRIORITY_CRITICAL),
      this.editor.registerCommand(OUTDENT_CONTENT_COMMAND, scheduleReposition, COMMAND_PRIORITY_CRITICAL),
      this.editor.registerCommand(INDENT_CONTENT_COMMAND, () => handleIndent(false), COMMAND_PRIORITY_HIGH),
      this.editor.registerCommand(OUTDENT_CONTENT_COMMAND, () => handleIndent(true), COMMAND_PRIORITY_HIGH),
      // Schedule highlight inheritance on Tab indent. Hooks into KEY_TAB_COMMAND
      // at HIGH (before the command_dispatcher at NORMAL) because
      // INDENT_CONTENT_COMMAND handlers at CRITICAL/HIGH don't reliably run —
      // the Lexical extension's own CRITICAL handler may consume the command first.
      this.editor.registerCommand(KEY_TAB_COMMAND, (event) => {
        if (!event.shiftKey) {
          setTimeout(() => {
            this.editor.update(() => {
              const selection = $getSelection()
              if (!$isRangeSelection(selection)) return
              const listItem = getListItemNode(selection.anchor.getNode())
              if (listItem) this.#inheritParentHighlight(listItem)
            })
          }, 0)
        }
        return false
      }, COMMAND_PRIORITY_HIGH),
      // Prevent Tab from moving focus out of the editor. Runs at LOW priority
      // so list/code handlers get first shot. If they don't handle it, consume
      // the event to keep focus inside the editor.
      this.editor.registerCommand(KEY_TAB_COMMAND, (event) => {
        event.preventDefault()
        return true
      }, COMMAND_PRIORITY_LOW)
    )
  }

  static MAX_NESTING_DEPTH = 10

  // Count how many ListNode ancestors a node has (= its nesting depth).
  // Indent: nest the wrapped block under its previous sibling (same visual position).
  // carryChildren: true = move structural wrapper with node (block-select mode),
  //                false = leave children behind to be re-parented (normal mode).
  // Returns true if indent was performed, false if no previous sibling found
  #indentWrappedBlock(node, carryChildren = true) {
    const parent = node.getParent()
    if (!$isListNode(parent)) return false

    // Find the previous content sibling (skip structural wrappers)
    let prev = node.getPreviousSibling()
    while (prev && $isListItemNode(prev) && $isStructuralWrapper(prev)) {
      prev = prev.getPreviousSibling()
    }
    // Capture the node's own children wrapper before moving
    const ownWrapper = carryChildren ? this.#getOwnStructuralWrapper(node) : null

    if (!prev || !$isListItemNode(prev)) {
      // No previous sibling — wrap in a structural wrapper (invisible, no text
      // content) to create deeper nesting. Matches Lexical's approach where
      // intermediate wrappers are hidden by CSS.
      const nestedList = $createListNode(parent.getListType())
      const wrapper = $createListItemNode()
      wrapper.append(nestedList)
      node.insertBefore(wrapper)
      nestedList.append(node)
      if (ownWrapper) node.insertAfter(ownWrapper)
      // Merge adjacent wrappers at the parent level
      this.#mergeAdjacentWrappers(parent)
      this.#inheritParentHighlight(node)
      return true
    }

    // Find or create the previous sibling's nested list
    let nestedList = null
    const wrapperCandidate = prev.getNextSibling()
    if (wrapperCandidate && $isListItemNode(wrapperCandidate)
        && $isStructuralWrapper(wrapperCandidate)
        && !wrapperCandidate.is(node)) {
      nestedList = wrapperCandidate.getChildren().find(c => $isListNode(c))
    }

    if (!nestedList) {
      nestedList = $createListNode(parent.getListType())
      const wrapper = $createListItemNode()
      wrapper.append(nestedList)
      prev.insertAfter(wrapper)
    }

    // Append to the end of the nested list (stays at same visual position)
    nestedList.append(node)
    if (ownWrapper) node.insertAfter(ownWrapper)
    // Merge adjacent structural wrappers at both levels
    this.#mergeAdjacentWrappers(nestedList)
    this.#mergeAdjacentWrappers(parent)
    this.#inheritParentHighlight(node)
    return true
  }

  // Outdent: promote the wrapped block to its parent list (same visual position).
  // Splits the nested list if the node is in the middle — items before stay in
  // the original wrapper, items after go into a new wrapper.
  // carryChildren: true = move structural wrapper with node (block-select mode),
  //                false = leave children behind (normal mode).
  // Returns true if outdent was performed
  #outdentWrappedBlock(node, carryChildren = true) {
    const currentList = node.getParent()
    if (!$isListNode(currentList)) return false

    const structuralWrapper = currentList.getParent()
    if (!$isListItemNode(structuralWrapper) || !$isStructuralWrapper(structuralWrapper)) return false

    // Capture trailing siblings (items after the node in the nested list)
    const ownWrapper = carryChildren ? this.#getOwnStructuralWrapper(node) : null
    const trailingSiblings = []
    let sib = (ownWrapper || node).getNextSibling()
    while (sib) {
      trailingSiblings.push(sib)
      sib = sib.getNextSibling()
    }

    // Insert the node after the structural wrapper in the parent list
    structuralWrapper.insertAfter(node)
    if (ownWrapper) node.insertAfter(ownWrapper)

    // If there were trailing siblings, move them into a new wrapper after the node
    if (trailingSiblings.length > 0) {
      const insertAfter = ownWrapper || node
      const newList = $createListNode(currentList.getListType())
      const newWrapper = $createListItemNode()
      newWrapper.append(newList)
      insertAfter.insertAfter(newWrapper)
      for (const trailing of trailingSiblings) {
        newList.append(trailing)
      }
    }

    // Clean up if the original nested list is now empty
    this.#cleanupEmptyList(currentList)
    // Merge adjacent structural wrappers in the parent list
    const parentList = node.getParent()
    if ($isListNode(parentList)) this.#mergeAdjacentWrappers(parentList)
    return true
  }

  // Flatten the children of a list item by one nesting level.
  // Promotes all items from the node's structural wrapper to be siblings
  // in the parent list, immediately after the node. Each press of
  // Shift+Tab removes one level of nesting until the list is fully flat.
  #flattenChildrenOneLevel(node) {
    const ownWrapper = this.#getOwnStructuralWrapper(node)
    if (!ownWrapper) return

    const nestedList = ownWrapper.getChildren().find(c => $isListNode(c))
    if (!nestedList) return

    // Move all items (content + their structural wrappers) from the nested
    // list to after the structural wrapper in the parent list. Moving as a
    // group preserves parent→child wrapper relationships within the items.
    const items = [ ...nestedList.getChildren() ]
    let insertAfter = ownWrapper
    for (const item of items) {
      insertAfter.insertAfter(item)
      insertAfter = item
    }

    // Remove the now-empty structural wrapper
    ownWrapper.remove()
  }

  // Extract wrapped items from their lists in place. Each wrapped item is
  // unwrapped to its original block type and the list splits around it,
  // leaving regular bullets in naturally-formed list segments.
  #extractWrappedItemsInPlace(exitGroup) {
    for (const { node, wrapper: ownWrapper } of exitGroup) {
      const currentList = node.getParent()
      if (!$isListNode(currentList)) continue

      const listType = currentList.getListType()

      // Collect trailing siblings (everything after this item and its wrapper)
      const startAfter = ownWrapper || node
      const trailing = []
      let sib = startAfter.getNextSibling()
      while (sib) {
        trailing.push(sib)
        sib = sib.getNextSibling()
      }

      // Handle children (structural wrapper with nested items)
      let childrenList = null
      if (ownWrapper) {
        const innerList = ownWrapper.getChildren().find(c => $isListNode(c))
        if (innerList) {
          innerList.remove()
          childrenList = innerList
        }
        ownWrapper.remove()
      }

      // Extract the wrapped content back to its original block type.
      // #extractWrappedContent leaves the (now empty) listItem in place with
      // preserveEmptyParent=true, so currentList still has its parent below.
      const extracted = this.#extractWrappedContent(node)
      if (!extracted) continue

      // Place extracted content and any trailing items FIRST, while
      // currentList still has its parent. Removing the empty listItem before
      // these inserts can trigger Lexical's !canBeEmpty cleanup cascade on
      // the ancestor list, detaching currentList (Lexical error #66).
      currentList.insertAfter(extracted)
      if (childrenList) extracted.insertAfter(childrenList)

      // Move trailing items to a new list after the extracted content
      if (trailing.length > 0) {
        const insertAfterNode = childrenList || extracted
        const newList = $createListNode(listType)
        insertAfterNode.insertAfter(newList)
        for (const t of trailing) {
          newList.append(t)
        }
      }

      // Now remove the empty wrapper. #cleanupEmptyList tolerates a list that
      // Lexical already auto-removed as part of the cascade.
      const nodeKey = node.getKey()
      node.remove()
      this.#cleanupEmptyList(currentList)
      this.#updateKeyAfterUnwrap(nodeKey, extracted.getKey())
    }
  }

  // Menu-driven "Remove Quote" action. Looks up the focused block, finds
  // the nearest enclosing QuoteNode (the block itself, or a list-item
  // parent), and unwraps it.
  // Menu-driven "Remove Quote" and "Remove Bullet"/"Remove Numbered" actions
  // both ultimately mean "get this content out of every wrapper it's in and
  // leave it at root level." The two entry points show different labels for
  // discoverability (the user who sees a blockquote bar expects a Remove
  // Quote, the user who sees a bullet expects Remove Bullet), but both
  // strip the full wrapper chain — any combination of blockquotes and list
  // items — until the content lives at root.
  #removeQuoteWrapper() { this.#extractContentToRoot() }
  #removeListWrapper() { this.#extractContentToRoot() }

  #extractContentToRoot() {
    const scrollY = window.scrollY
    this.#selectionHistory.push()
    this.editor.update(() => {
      // Peel one wrapper layer at a time, top-down. Each iteration either
      // (a) unwraps a blockquote whose content is non-text, or (b) extracts
      // a list item out of its containing list. Tracking is via #focusKey
      // which the unwrap/extract helpers update as keys change.
      let guard = 20
      while (guard-- > 0) {
        const node = $getNodeByKey(this.#focusKey)
        if (!node) return
        const parent = node.getParent()
        if (!parent) return

        if ($isQuoteNode(node)) {
          // Focused node itself is a blockquote wrapping a non-text block —
          // typical standalone <blockquote><hr></blockquote> scenario.
          const before = this.#focusKey
          this.#unwrapQuoteIfWrappingNonText(node)
          if (this.#focusKey === before) return // no-op guard
          continue
        }

        if ($isListItemNode(node)) {
          // Focused node is a list item. Outdent through nested lists to
          // root, then extract in place (splits the root-level list around
          // the item).
          let nested = 50
          while (nested-- > 0 && this.#outdentWrappedBlock(node)) {
            const refreshed = $getNodeByKey(node.getKey())
            if (!refreshed || !$isListItemNode(refreshed)) return
          }
          const liNow = $getNodeByKey(this.#focusKey)
          if (!liNow || !$isListItemNode(liNow)) continue
          const wrapper = this.#getOwnStructuralWrapper(liNow)
          this.#extractWrappedItemsInPlace([ { node: liNow, wrapper } ])
          continue
        }

        // Node isn't a wrapper itself. Nothing more to peel.
        return
      }
    }, { tag: HISTORY_PUSH_TAG })
    this.#syncAndRefocus()
    // Lexical's selection restoration after the update calls
    // scrollIntoViewIfNeeded; restore the pre-update scroll position in a
    // microtask so the page doesn't jump to wherever the restored
    // selection lands.
    queueMicrotask(() => window.scrollTo(window.scrollX, scrollY))
  }

  // Unwrap a blockquote that contains a single non-text block (decorator,
  // HR, attachment, code, table). Replaces the blockquote with its content,
  // promoting the wrapped element to the blockquote's former position.
  // Triggered by Shift+Tab in block-select mode on a quoted decorator —
  // there's no "Turn into Text" path for decorators, so this is the only
  // way to remove the quote wrapper without destroying the content.
  #unwrapQuoteIfWrappingNonText(quote) {
    const children = quote.getChildren()
    if (children.length !== 1) return
    const child = children[0]
    const isNonTextBlock = ($isElementNode(child) || $isDecoratorNode(child))
      && !$isListNode(child) && !$isParagraphNode(child)
    if (!isNonTextBlock) return

    const oldKey = quote.getKey()
    // Detach the child, then replace the quote with it so the child lands
    // at the quote's former root position.
    child.remove(true)
    quote.replace(child)
    this.#updateKeyAfterUnwrap(oldKey, child.getKey())
  }

  // -- Click handling ---------------------------------------------------------

  #registerClickHandler() {
    this.#cleanupFns.push(
      this.editor.registerCommand(CLICK_COMMAND, this.#handleClick.bind(this), COMMAND_PRIORITY_CRITICAL)
    )
  }

  // Intercept mousedown on decorator blocks (HR) at the capture phase, BEFORE
  // Lexical's own mousedown handler. This prevents Lexical from creating a
  // NodeSelection (and showing its own delete-button UI) for these elements.
  // Instead, we enter block-select mode in the subsequent click handler.
  // Intercept all pointer events on decorator blocks (HR) at the capture phase,
  // BEFORE Lexical's own handlers. This prevents Lexical from creating a
  // NodeSelection (and showing its own delete-button UI) for these elements.
  #registerDecoratorClickInterceptor() {
    function isNodeControlClick(event) {
      return event.target.closest("lexxy-attachment-controls")
    }

    const onMouseDown = (event) => {
      const decorator = event.target.closest(".horizontal-divider")
      if (!decorator || isNodeControlClick(event)) return

      event.stopPropagation()

      const blockElement = this.#findBlockElementFromDOM(decorator)
      if (blockElement) {
        const nodeKey = getNodeKeyFromElement(blockElement)
        if (nodeKey) {
          this.enterBlockSelectMode(nodeKey)
        }
      }
    }

    // Also intercept mouseup and click to prevent Lexical's deferred selection,
    // but allow clicks on the node delete button to pass through.
    function suppressIfDecorator(event) {
      if (event.target.closest(".horizontal-divider") && !isNodeControlClick(event)) {
        event.stopPropagation()
      }
    }

    const decoratorRoot = this.root
    decoratorRoot?.addEventListener("mousedown", onMouseDown, true)
    decoratorRoot?.addEventListener("mouseup", suppressIfDecorator, true)
    decoratorRoot?.addEventListener("click", suppressIfDecorator, true)
    this.#cleanupFns.push(() => {
      decoratorRoot?.removeEventListener("mousedown", onMouseDown, true)
      decoratorRoot?.removeEventListener("mouseup", suppressIfDecorator, true)
      decoratorRoot?.removeEventListener("click", suppressIfDecorator, true)
    })
  }

  #handleClick(event) {
    if (this.#isPromptOpen()) return false

    const rootElement = this.root
    if (!rootElement) return false

    const target = event.target
    if (!rootElement.contains(target)) {
      if (this.isBlockSelectMode) {
        this.#exitBlockSelectMode()
      }
      return false
    }

    const blockElement = this.#findBlockElementFromDOM(target)
    if (!blockElement) {
      if (this.isBlockSelectMode) {
        this.#exitBlockSelectMode()
      }
      return false
    }

    const editorRect = rootElement.getBoundingClientRect()
    const gutterThreshold = editorRect.left + 4
    const isGutterClick = event.clientX < gutterThreshold

    if (isGutterClick) {
      const nodeKey = getNodeKeyFromElement(blockElement)
      if (nodeKey) {
        if (event.shiftKey && this.isBlockSelectMode) {
          this.#selectBlock(nodeKey, true)
        } else {
          this.enterBlockSelectMode(nodeKey)
        }
        return true
      }
    }

    // Clicking on a decorator block (HR, images) enters block-select mode
    // rather than using Lexical's default decorator selection.
    if (this.#isDecoratorBlock(blockElement)) {
      const nodeKey = getNodeKeyFromElement(blockElement)
      if (nodeKey) {
        this.enterBlockSelectMode(nodeKey)
        return true
      }
    }

    if (this.isBlockSelectMode) {
      this.#exitBlockSelectMode()
      return false
    }

    return false
  }

  #isDecoratorBlock(element) {
    return element?.classList?.contains("horizontal-divider") ||
           element?.closest?.(".horizontal-divider") !== null
  }

  #findBlockElementFromDOM(element) {
    const rootElement = this.root
    if (!rootElement) return null

    let current = element
    while (current && current !== rootElement) {
      if (current.parentElement === rootElement) return current
      if (current.tagName === "LI") return current
      current = current.parentElement
    }
    return null
  }

  // -- Utilities --------------------------------------------------------------

  #scrollBlockIntoView(nodeKey) {
    const el = this.editor.getElementByKey(nodeKey)
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }

  // -- Public API for drag-and-drop -------------------------------------------

  getSelectedBlockKeys() {
    return new Set(this.#selectedBlockKeys)
  }

  selectBlockByKey(nodeKey) {
    this.enterBlockSelectMode(nodeKey)
  }
}
