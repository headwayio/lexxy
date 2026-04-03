import LexxyExtension from "./lexxy_extension"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
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
  INDENT_CONTENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND
} from "lexical"
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, ListItemNode } from "@lexical/list"
import { $isCodeNode } from "@lexical/code"
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text"
import { TOGGLE_HIGHLIGHT_COMMAND } from "./highlight_extension"
import { getCSSFromStyleObject, getStyleObjectFromCSS } from "@lexical/selection"
import { hasHighlightStyles } from "../helpers/format_helper"
import { BlockDragAndDrop } from "../editor/block_drag_and_drop"
import { $isStructuralWrapper, BLOCK_FOCUSED_CLASS, BLOCK_SELECTED_CLASS, BLOCK_SELECTION_ACTIVE_CLASS } from "../editor/block_helpers"

export class BlockSelectionExtension extends LexxyExtension {
  #mode = "edit"
  #selectedBlockKeys = new Set()
  #previousSelectedKeys = new Set()
  #anchorKey = null
  #focusKey = null
  #savedHighlightStyles = new Map() // nodeKey → original style string (before parent color was applied)
  #dragAndDrop = null
  #cleanupFns = []
  #wrappedBlockKeys = new Set() // ListItemNode keys created by block movement
  #blockActionsMenu = null
  #deleteNeighbors = null // { next, prev } keys after a delete, for arrow key navigation

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
    this.#registerEscapeHandler()
    this.#registerClickHandler()
    this.#registerDecoratorClickInterceptor()
    this.#registerDirectKeydownHandler()
    this.#registerWrappedBlockIndentHandler()
    this.#registerEnterOnWrappedBlock()
    this.#registerHighlightClearOnEnter()
    this.#registerHighlightPropagation()
    this.#registerBulletMarkerColorSync()
    this.#registerBlockSelectFormatHandler()
    this.#dragAndDrop = new BlockDragAndDrop(this.editor, this.editorElement, this)
    this.#registerBulletOffsetSyncListener()
  }

  destroy() {
    this.#exitBlockSelectMode()
    this.#dragAndDrop?.destroy()
    for (const fn of this.#cleanupFns) fn()
    this.#cleanupFns = []
  }

  setShowHandles(show) {
    this.#dragAndDrop?.setShowHandles(show)
  }

  /** True when one or more blocks are selected (block-select mode). */
  get hasBlockSelection() {
    return this.#mode === "block-select"
  }

  // -- Mode transitions -------------------------------------------------------

  enterBlockSelectMode(nodeKey) {
    if (this.#mode === "block-select" && this.#selectedBlockKeys.has(nodeKey)) return


    this.#mode = "block-select"
    this.root?.classList.add(BLOCK_SELECTION_ACTIVE_CLASS)

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
      this.#selectRange(this.#anchorKey, nodeKey)
    }

    this.#syncSelectionClasses()
  }

  // Collect keys of items nested under a list item (in its structural wrappers).
  // Walks ALL consecutive structural wrappers after the node — handles cases
  // where multiple wrappers exist (e.g., from list splitting or deep nesting).
  #collectChildKeys(listItemNode, keySet) {
    let next = listItemNode.getNextSibling()
    const childKeys = []
    while (next && $isListItemNode(next) && $isStructuralWrapper(next)) {
      for (const child of next.getChildren()) {
        if ($isListNode(child)) {
          this.#collectListItemKeys(child, childKeys)
        }
      }
      next = next.getNextSibling()
    }
    for (const key of childKeys) {
      keySet.add(key)
    }
  }

  #selectRange(fromKey, toKey) {
    const allBlocks = this.#getDocumentOrderBlockKeys()
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
          el.classList.remove(BLOCK_SELECTED_CLASS, BLOCK_FOCUSED_CLASS)
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

    this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
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
        keys.push(child.getKey())
        for (const grandchild of child.getChildren()) {
          if ($isListNode(grandchild)) {
            this.#collectListItemKeys(grandchild, keys)
          }
        }
      }
    }
  }

  #getNextBlockKey(currentKey) {
    const allKeys = this.#getNavigableBlockKeys()
    const index = allKeys.indexOf(currentKey)
    if (index === -1 || index >= allKeys.length - 1) return null
    return allKeys[index + 1]
  }

  #getPreviousBlockKey(currentKey) {
    const allKeys = this.#getNavigableBlockKeys()
    const index = allKeys.indexOf(currentKey)
    if (index <= 0) return null
    return allKeys[index - 1]
  }

  // Block keys suitable for arrow-key navigation — excludes ListNode
  // containers since they aren't visually selectable.
  #getNavigableBlockKeys() {
    const allKeys = this.#getDocumentOrderBlockKeys()
    return allKeys.filter(key => {
      let isNavigable = true
      this.editor.getEditorState().read(() => {
        const node = $getNodeByKey(key)
        if ($isListNode(node)) isNavigable = false
      })
      return isNavigable
    })
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
    return !!this.editorElement.querySelector("lexxy-prompt[open]")
  }

  #isBlockActionsMenuOpen() {
    return this.#blockActionsMenu && !this.#blockActionsMenu.hidden
  }

  #handleKeydown(event) {
    if (!this.editor) return

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
      case "ArrowUp":
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
          const prevKey = this.#getPreviousBlockKey(this.#focusKey)
          if (prevKey) {
            this.#selectBlock(prevKey, event.shiftKey)
            this.#scrollBlockIntoView(prevKey)
          }
        }
        break

      case "ArrowDown":
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
          const nextKey = this.#getNextBlockKey(this.#focusKey)
          if (nextKey) {
            this.#selectBlock(nextKey, event.shiftKey)
            this.#scrollBlockIntoView(nextKey)
          }
        }
        break

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
    const selectedSet = new Set(this.#selectedBlockKeys)
    let nextKey = null
    let prevKey = null

    const lastSelectedIdx = Math.max(...[ ...selectedSet ].map(k => allKeys.indexOf(k)))
    for (let i = lastSelectedIdx + 1; i < allKeys.length; i++) {
      if (!selectedSet.has(allKeys[i])) { nextKey = allKeys[i]; break }
    }
    const firstSelectedIdx = Math.min(...[ ...selectedSet ].map(k => allKeys.indexOf(k)))
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
    const topLevelKeys = []
    this.editor.getEditorState().read(() => {
      const root = $getRoot()
      for (const child of root.getChildren()) {
        topLevelKeys.push(child.getKey())
      }
    })

    if (topLevelKeys.length > 0) {
      this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
      this.#selectedBlockKeys = new Set(topLevelKeys)
      this.#anchorKey = topLevelKeys[0]
      this.#focusKey = topLevelKeys[topLevelKeys.length - 1]
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

    this.#blockActionsMenu.show({
      anchorElement: focusedEl,
      editorElement: this.editorElement,
      onAction: (action) => this.#handleBlockAction(action),
      onClose: () => this.root?.focus()
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
    this.editor.update(() => {
      const keys = [ ...this.#selectedBlockKeys ]
      for (const key of keys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        const textNodes = []
        this.#collectTextNodes(node, textNodes)
        const ownWrapper = $isListItemNode(node) ? this.#getOwnStructuralWrapper(node) : null
        if (ownWrapper) this.#collectAllDescendantTextNodes(ownWrapper, textNodes)

        for (const t of textNodes) {
          const existing = getStyleObjectFromCSS(t.getStyle() || "")
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
    const isListCommand = command === "insertUnorderedList" || command === "insertOrderedList"
    const listType = command === "insertUnorderedList" ? "bullet" : "number"

    this.editor.update(() => {
      const newSelectedKeys = new Set()

      for (const key of this.#selectedBlockKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

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
              this.#wrappedBlockKeys.delete(node.getKey())
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
              this.#wrappedBlockKeys.delete(node.getKey())
            }
            newSelectedKeys.add(node.getKey())
          } else {
            // List item → wrapped block: convert inline content to a wrapped
            // block element (e.g., heading, quote) inside the list item.
            this.#wrapListItemContent(node, command)
            newSelectedKeys.add(node.getKey())
          }
        } else {
          // Non-list block: use temporary selection + command dispatch.
          // The command may replace the node (e.g., paragraph → heading),
          // so find the block at the same position after dispatch.
          const parent = node.getParent()
          const index = node.getIndexWithinParent()

          if (node.selectStart) node.selectStart()
          else if (node.select) node.select()
          this.editor.dispatchCommand(command)
          $setSelection(null)

          // Find the replacement node at the same position
          const latestParent = $getNodeByKey(parent.getKey()) || $getRoot()
          const children = latestParent.getChildren()
          const replacement = children[Math.min(index, children.length - 1)]
          if (replacement) newSelectedKeys.add(replacement.getKey())
        }
      }

      // Merge keys from #extractListItemAsBlock with new keys.
      // Only include nodes still attached to the document tree —
      // replaced nodes (e.g., paragraph → heading) linger in the
      // node map as orphans during the update callback.
      for (const key of this.#selectedBlockKeys) {
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
    }, { tag: HISTORY_MERGE_TAG })

    this.#syncAndRefocus()
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

    // Track as a wrapped block
    this.#wrappedBlockKeys.add(node.getKey())
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
      default: return null
    }
  }

  #handleDuplicate() {
    this.editor.update(() => {
      const allKeys = this.#getDocumentOrderBlockKeys()
      const sortedKeys = [ ...this.#selectedBlockKeys ].sort(
        (a, b) => allKeys.indexOf(a) - allKeys.indexOf(b)
      )

      const newKeys = []
      // Insert clones after the LAST selected block so the group stays together
      let insertAfterNode = $getNodeByKey(sortedKeys[sortedKeys.length - 1])

      for (const key of sortedKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        const clone = $parseSerializedNode(this.#exportNodeWithChildren(node))
        if (insertAfterNode) {
          insertAfterNode.insertAfter(clone)
          insertAfterNode = clone
        }
        newKeys.push(clone.getKey())
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
    this.editor.update(() => {
      // Filter to root keys only (parents, not their auto-selected children)
      const rootKeys = this.#filterToRootKeys([ ...this.#selectedBlockKeys ])
      const listItemKeys = rootKeys.filter(key => {
        const node = $getNodeByKey(key)
        return node && $isListItemNode(node)
      })
      if (listItemKeys.length === 0) return

      // Process each item: use wrapped-block indent for non-text blocks,
      // Lexical's standard indent for regular list items.
      for (const key of listItemKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        const children = node.getChildren()
        const isWrapped = children.some(c =>
          $isElementNode(c) && !$isListNode(c) && !$isParagraphNode(c)
        )
        const hasChildren = !!this.#getOwnStructuralWrapper(node)

        if (isWrapped || hasChildren) {
          // Wrapped blocks or items with children — use our indent/outdent
          // which carries the structural wrapper with the node
          if (outdent) {
            this.#outdentWrappedBlock(node)
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

      $setSelection(null)
    }, { tag: HISTORY_MERGE_TAG })

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
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

    // Filter to only "root" keys — parents whose children are also selected.
    // When a parent is selected with its children, only move the parent;
    // the children travel with it via the structural wrapper.
    const rootKeys = this.#filterToRootKeys(selectedKeys)

    const allKeys = this.#getDocumentOrderBlockKeys()
    rootKeys.sort((a, b) => allKeys.indexOf(a) - allKeys.indexOf(b))

    this.editor.update(() => {
      if (direction === "up") {
        for (const key of rootKeys) {
          this.#moveSingleBlock(key, "up")
        }
      } else {
        for (let i = rootKeys.length - 1; i >= 0; i--) {
          this.#moveSingleBlock(rootKeys[i], "down")
        }
      }
      // Re-sync wrapped keys with current selection after all moves.
      // Lexical's copy-on-write may have changed keys during the update.
      this.#resyncWrappedKeys()

    }, { tag: "history-push" })

    // After the update completes and Lexical reconciles, apply highlight
    // inheritance. Done outside the update to ensure final positions are settled.
    setTimeout(() => {
      this.editor.update(() => {
        for (const key of rootKeys) {
          const node = $getNodeByKey(key)
          if (node && $isListItemNode(node)) {
            this.#applyOrRestoreParentHighlight(node)
          }
        }
      })
    }, 0)

    requestAnimationFrame(() => {
      this.#syncSelectionClasses()
      this.#syncWrappedBlockAttributes()
      // Double-RAF: first waits for Lexical's DOM reconciliation,
      // second ensures layout is computed before positioning
      requestAnimationFrame(() => {
        this.#dragAndDrop?.repositionHandle()
        this.#syncBulletOffsets()
        this.#dragAndDrop?.unsuppressHover()
      })
    })
  }

  // Given a set of selected keys, return only the "root" keys — items that
  // are not children of another selected item. This prevents moving children
  // individually when the parent already moves them via its structural wrapper.
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

  // Re-apply data-block-movement-wrapped DOM attribute after moves.
  // Also re-sync the key set since Lexical's copy-on-write may reassign keys.
  #syncWrappedBlockAttributes() {
    const root = this.editor.getRootElement()
    if (!root) return

    // First, apply attribute from known keys
    for (const key of this.#wrappedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (el) {
        el.dataset.blockMovementWrapped = ""
      } else {
        this.#wrappedBlockKeys.delete(key)
      }
    }

    // Also scan DOM for any elements that have the attribute but whose
    // keys aren't in the set (key changed due to copy-on-write)
    for (const el of root.querySelectorAll("[data-block-movement-wrapped]")) {
      const keyProp = Object.keys(el).find(k => k.startsWith("__lexicalKey_"))
      if (keyProp) {
        this.#wrappedBlockKeys.add(el[keyProp])
      }
    }
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
    this.root?.addEventListener("lexxy:sync-wrapped-block", handler)
    this.#cleanupFns.push(() => this.root?.removeEventListener("lexxy:sync-wrapped-block", handler))
  }

  #syncBulletOffsets() {
    if (!this.#dragAndDrop) return
    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (el) this.#dragAndDrop.syncBulletOffset(el)
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
    // should unwrap (hidden-bullet block) or move the whole list
    if (isRootLevel && this.#countRealItems(parent) === 1) {
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
      // Normal single list item: move the entire list as a block
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

    // eslint-disable-next-line no-unused-vars
    const nodeKey = node.getKey()

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
      if (isTargetRootLevel && this.#isWrappedBlock(node)) {
        this.#promoteWrappedBlockThroughRoot(node, currentList, listParent, parentList, isDown)
        return
      }

      // Standard promotion: move to parent list level.
      // The listParent is the structural wrapper ListItemNode. When moving
      // UP, we want to go before the TEXT ListItemNode that precedes the
      // wrapper (the item the user sees as the "parent"). When moving DOWN,
      // inserting after the wrapper is correct.
      // Capture the node's children wrapper BEFORE moving.
      const ownWrapper = this.#getOwnStructuralWrapper(node)

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
      // Move children wrapper right after the node in the new position
      if (ownWrapper) {
        node.insertAfter(ownWrapper)
      }
      this.#cleanupEmptyList(currentList)
    } else {
      // Root-level list boundary.

      // Wrapped blocks (paragraphs, headings that entered via block movement):
      // extract and place beside the list as standalone elements.
      // They CAN exit even at document start.
      if (this.#isWrappedBlock(node)) {
        const extracted = this.#extractWrappedContent(node)
        if (extracted) {
          const nodeKey = node.getKey()
          node.remove()
          this.#cleanupEmptyList(currentList)
          if (isDown) {
            currentList.insertAfter(extracted)
          } else {
            currentList.insertBefore(extracted)
          }
          this.#updateKeyAfterUnwrap(nodeKey, extracted.getKey())
          return
        }
      }

      // Regular list items: wrap in a new sibling list and move it.
      // Can't break out upward if at document start.
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

    if (targetSibling) {
      // Nest under the adjacent root-level sibling (skip root level).
      // #nestListItemUnderSibling handles atomic move and cleanup.
      this.#nestListItemUnderSibling(node, targetSibling, rootList, isDown)
    } else {
      // No more siblings: extract and exit the list
      const extracted = this.#extractWrappedContent(node)
      if (extracted) {
        const nodeKey = node.getKey()
        node.remove()
        if (isDown) {
          rootList.insertAfter(extracted)
        } else {
          rootList.insertBefore(extracted)
        }
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

    // Non-paragraph block child (heading, code, table, etc.) — always extract.
    // Must be an ElementNode to distinguish from inline TextNodes.
    if (children.length === 1 && $isElementNode(children[0])
        && !$isListNode(children[0]) && !$isParagraphNode(children[0])) {
      const child = children[0]
      child.remove()
      return child
    }

    // Paragraph case: Lexical merges <p> content into <li> as raw inline
    // nodes (TextNode, spans). Reconstruct a ParagraphNode from them.
    // Only for wrapped blocks (not regular list items).
    if (this.#isWrappedBlock(listItemNode)) {
      // Check if there's still a ParagraphNode child
      for (const child of children) {
        if ($isParagraphNode(child)) {
          child.remove()
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
        // Non-list block entering a list: wrap in a ListItemNode and nest
        // under the first/last real item for immediate depth-first entry.
        const oldKey = node.getKey()
        const listItem = $createListItemNode()
        listItem.append(node)

        const targetItem = isDown
          ? this.#findFirstRealItem(sibling)
          : this.#findLastRealItem(sibling)

        if (targetItem) {
          this.#nestListItemUnderSibling(listItem, targetItem, sibling, isDown)
        } else {
          sibling.append(listItem)
        }

        // Track this as a block-movement-wrapped item
        this.#wrappedBlockKeys.add(listItem.getKey())

        // Update selection to track the wrapper ListItemNode
        const newKey = listItem.getKey()
        if (this.#selectedBlockKeys.has(oldKey)) {
          this.#selectedBlockKeys.delete(oldKey)
          this.#selectedBlockKeys.add(newKey)
          if (this.#anchorKey === oldKey) this.#anchorKey = newKey
          if (this.#focusKey === oldKey) this.#focusKey = newKey
        }
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

  // Re-sync the wrappedBlockKeys Set after moves. Selected nodes that
  // are ListItemNodes inside a list should be checked against the Set —
  // if they're not in it but WERE wrapped (the Set had their old key),
  // add the new key.
  #resyncWrappedKeys() {
    const newSet = new Set()
    for (const key of this.#selectedBlockKeys) {
      const node = $getNodeByKey(key)
      if (!node) continue
      // If this selected node is a ListItemNode, check if it should be wrapped
      if ($isListItemNode(node)) {
        if (this.#wrappedBlockKeys.has(key)) {
          newSet.add(key)
        }
      }
      // Also check parent (for nodes inside a wrapper)
      if (node.getParent && $isListItemNode(node.getParent())) {
        const parentKey = node.getParent().getKey()
        if (this.#wrappedBlockKeys.has(parentKey)) {
          newSet.add(parentKey)
        }
      }
    }
    // Merge: keep existing valid keys + add new ones
    for (const key of this.#wrappedBlockKeys) {
      if ($getNodeByKey(key)) newSet.add(key)
    }
    this.#wrappedBlockKeys = newSet
  }

  // Check if a ListItemNode is a block-movement wrapper.
  #isWrappedBlock(listItemNode) {
    const key = listItemNode.getKey()
    if (this.#wrappedBlockKeys.has(key)) return true

    // Content heuristic: a single block-level element child (heading, code block,
    // table, etc.) means this list item is wrapping a non-list block that entered
    // via block movement. Excludes inline nodes (TextNode) which are native list
    // item content, and excludes ParagraphNode/ListNode.
    const children = listItemNode.getChildren()
    if (children.length === 1 && $isElementNode(children[0])
        && !$isListNode(children[0]) && !$isParagraphNode(children[0])) {
      return true
    }

    // If this node is the one we're actively moving (selected/focused),
    // check the DOM attribute from the previous render
    try {
      const el = this.editor.getElementByKey(key)
      if (el?.hasAttribute("data-block-movement-wrapped")) return true
    } catch (e) { /* ignore */ }

    // Also check all wrappedBlockKeys to see if any resolve to this node
    // (keys may have changed due to copy-on-write)
    for (const wrappedKey of this.#wrappedBlockKeys) {
      try {
        const wrappedNode = $getNodeByKey(wrappedKey)
        if (wrappedNode && wrappedNode.is(listItemNode)) return true
      } catch (e) { /* ignore */ }
    }

    return false
  }

  // Update selection tracking when a wrapper ListItemNode is unwrapped
  // back to its standalone content node.
  #updateKeyAfterUnwrap(oldKey, newKey) {
    this.#wrappedBlockKeys.delete(oldKey)
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
        const scrollEl = this.root?.closest("[style*=overflow], [class*=overflow]")
        const scrollTop = scrollEl?.scrollTop
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
        // Restore scroll position and focus without scrolling
        window.scrollTo({ top: scrollY })
        if (scrollEl && scrollTop !== undefined) scrollEl.scrollTop = scrollTop
        this.root?.focus({ preventScroll: true })
        requestAnimationFrame(() => this.#syncSelectionClasses())
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
          if (checkStyle && this.#extractHighlightFromCSS(checkStyle)) {
            if (this.#shouldRetainHighlightFromParent(anchor, checkStyle)) {
              // Retaining parent color — set the <li> element style so the
              // bullet marker is colored immediately (the transform can't
              // detect color from an empty item with no text nodes yet).
              if ($isListItemNode(anchor)) {
                const highlight = this.#extractHighlightFromCSS(checkStyle)
                if (highlight?.color) {
                  anchor.setStyle(this.#mergeHighlightIntoCSS(anchor.getStyle(), { color: highlight.color }))
                }
              }
              return
            }
            const cleared = this.#removeHighlightFromCSS(checkStyle) ?? ""
            selection.setStyle(cleared)
            if ($isListItemNode(anchor)) {
              anchor.setTextStyle(this.#removeHighlightFromCSS(anchor.getTextStyle()) ?? "")
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
      if (this.#extractHighlightFromCSS(style)) {
        // Has highlight — check if parent retains it
        if (this.#shouldRetainHighlightFromParent(anchor, style)) {
          let listItem = anchor.getParent()
          while (listItem && !$isListItemNode(listItem)) listItem = listItem.getParent()
          if (listItem) {
            const highlight = this.#extractHighlightFromCSS(style)
            if (highlight?.color) {
              listItem.setStyle(this.#mergeHighlightIntoCSS(listItem.getStyle(), { color: highlight.color }))
            }
          }
          return
        }
        const cleared = this.#removeHighlightFromCSS(style)
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
        if (!this.#isWrappedBlock(listItem)) return false

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
    const firstHighlight = this.#extractHighlightFromCSS(rawStyle)
    if (!firstHighlight) return

    // Verify all parent text nodes share the same highlight colors
    const allMatch = textNodes.every(t => {
      const h = this.#extractHighlightFromCSS(t.getStyle())
      return h &&
        (h.color || "") === (firstHighlight.color || "") &&
        (h["background-color"] || "") === (firstHighlight["background-color"] || "")
    })
    if (!allMatch) return

    // Apply the parent's color to existing text nodes in the child
    const childTextNodes = []
    this.#collectTextNodes(node, childTextNodes)
    const ownWrapper = this.#getOwnStructuralWrapper(node)
    if (ownWrapper) this.#collectAllDescendantTextNodes(ownWrapper, childTextNodes)

    for (const textNode of childTextNodes) {
      const newStyle = this.#mergeHighlightIntoCSS(textNode.getStyle(), firstHighlight)
      textNode.setStyle(newStyle)
    }

    // Always set the ListItemNode text style and selection style so that
    // continued typing inherits the parent's color. The bullet marker color
    // is handled by the #registerBulletMarkerColorSync transform.
    if ($isListItemNode(node)) {
      node.setTextStyle(this.#mergeHighlightIntoCSS(node.getTextStyle(), firstHighlight))
    }
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      selection.setStyle(this.#mergeHighlightIntoCSS(selection.style, firstHighlight))
    }
  }

  // Extract color and background-color from a raw CSS string. Returns an
  // object with those properties, or null if neither is present. Uses manual
  // parsing because getStyleObjectFromCSS (from @lexical/selection) fails to
  // parse CSS var() values in some Rollup build configurations.
  #extractHighlightFromCSS(css) {
    if (!css) return null
    const result = {}
    const colorMatch = css.match(/(?:^|;\s*)color\s*:\s*([^;]+)/)
    const bgMatch = css.match(/(?:^|;\s*)background-color\s*:\s*([^;]+)/)
    if (colorMatch) result.color = colorMatch[1].trim()
    if (bgMatch) result["background-color"] = bgMatch[1].trim()
    return (result.color || result["background-color"]) ? result : null
  }

  // Merge highlight properties into an existing CSS string, preserving
  // other properties (bold, italic, font-size, etc.).
  #mergeHighlightIntoCSS(existingCSS, highlight) {
    const parts = (existingCSS || "").split(";").filter(s => s.trim())
    const nonHighlight = parts.filter(p => {
      const key = p.split(":")[0]?.trim()
      return key !== "color" && key !== "background-color"
    })
    if (highlight.color) nonHighlight.push(`color: ${highlight.color}`)
    if (highlight["background-color"]) nonHighlight.push(`background-color: ${highlight["background-color"]}`)
    return nonHighlight.join(";") + ";"
  }

  // Remove color and background-color from a CSS string, preserving other props.
  // Returns null (not "") when no properties remain — callers should skip
  // setStyle entirely for null to avoid setting an explicit empty style that
  // overrides the CSS-inherited default text color.
  #removeHighlightFromCSS(css) {
    if (!css) return null
    const parts = css.split(";").filter(s => s.trim())
    const kept = parts.filter(p => {
      const key = p.split(":")[0]?.trim()
      return key !== "color" && key !== "background-color"
    })
    return kept.length > 0 ? kept.join(";") + ";" : null
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
      let listItem = null
      let current = selection.anchor.getNode()
      while (current) {
        if ($isListItemNode(current)) { listItem = current; break }
        current = current.getParent()
      }
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

  // Sync the <li> element's color from its text content so that bullet markers
  // (which use currentColor via ::before) match the text color. Runs as a
  // node transform on every dirty ListItemNode, covering all highlight paths:
  // direct toggle, indent inheritance, paste, undo, etc.
  #registerBulletMarkerColorSync() {
    this.#cleanupFns.push(
      this.editor.registerNodeTransform(ListItemNode, (node) => {
        if ($isStructuralWrapper(node)) return

        const textNodes = []
        node.getChildren().forEach(c => {
          if (!$isListNode(c)) this.#collectTextNodes(c, textNodes)
        })

        const highlight = textNodes.length > 0
          ? this.#extractHighlightFromCSS(textNodes[0].getStyle())
          : null

        const liHighlight = this.#extractHighlightFromCSS(node.getStyle())

        // For empty items, fall back to textStyle (controls what color new
        // text will be typed in — set by inheritance or Enter retention).
        const effectiveHighlight = highlight
          || this.#extractHighlightFromCSS(node.getTextStyle())

        if (effectiveHighlight?.color) {
          // Text (or pending text) is colored → set <li> color for bullet marker
          const allSameColor = !highlight || textNodes.every(t => {
            const h = this.#extractHighlightFromCSS(t.getStyle())
            return h && (h.color || "") === (effectiveHighlight.color || "")
          })
          if (allSameColor && (liHighlight?.color || "") !== effectiveHighlight.color) {
            node.setStyle(this.#mergeHighlightIntoCSS(node.getStyle(), { color: effectiveHighlight.color }))
          }
        } else if (liHighlight?.color) {
          // No text or pending highlight → clear <li> color
          node.setStyle(this.#removeHighlightFromCSS(node.getStyle()) ?? "")
        }
      })
    )
  }

  // Collect text nodes, skipping code blocks (they have their own syntax colors)
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
    const parentColor = this.#getUniformParentHighlight(node)

    if (parentColor) {
      // Entering a highlighted parent — save original and apply parent color
      // to node AND all its descendants
      const textNodes = []
      this.#collectTextNodes(node, textNodes)
      const ownWrapper = this.#getOwnStructuralWrapper(node)
      if (ownWrapper) this.#collectAllDescendantTextNodes(ownWrapper, textNodes)
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
      const textNodes = []
      this.#collectTextNodes(node, textNodes)
      const ownWrapper2 = this.#getOwnStructuralWrapper(node)
      if (ownWrapper2) this.#collectAllDescendantTextNodes(ownWrapper2, textNodes)
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
  #getUniformParentHighlight(node) {
    let currentList = node.getParent()

    while ($isListNode(currentList)) {
      const wrapper = currentList.getParent()
      if (!$isListItemNode(wrapper)) break

      const textItem = wrapper.getPreviousSibling()
      if (!textItem || !$isListItemNode(textItem)) break

      // Skip code blocks — check the next ancestor up
      const textNodes = []
      textItem.getChildren().forEach(c => { if (!$isListNode(c)) this.#collectTextNodes(c, textNodes) })

      if (textNodes.length > 0) {
        const style = textNodes[0].getStyle()
        if (style && hasHighlightStyles(style) && textNodes.every(t => t.getStyle() === style)) {
          return style
        }
        // Parent has text but no uniform highlight — stop looking
        return null
      }

      // No text nodes (code block or empty) — walk up to grandparent
      currentList = wrapper.getParent()
    }

    return null
  }

  // Like #getUniformParentHighlight but only checks the immediate parent,
  // not ancestors further up the tree.
  #getImmediateParentHighlight(listItem) {
    const parentList = listItem.getParent()
    if (!$isListNode(parentList)) return null

    const wrapper = parentList.getParent()
    if (!$isListItemNode(wrapper)) return null

    const textItem = wrapper.getPreviousSibling()
    if (!textItem || !$isListItemNode(textItem)) return null

    const textNodes = []
    textItem.getChildren().forEach(c => {
      if (!$isListNode(c)) this.#collectTextNodes(c, textNodes)
    })

    if (textNodes.length === 0) return null

    const firstHighlight = this.#extractHighlightFromCSS(textNodes[0].getStyle())
    if (!firstHighlight) return null

    // Verify all parent text nodes share the same highlight
    const allMatch = textNodes.every(t => {
      const h = this.#extractHighlightFromCSS(t.getStyle())
      return h &&
        (h.color || "") === (firstHighlight.color || "") &&
        (h["background-color"] || "") === (firstHighlight["background-color"] || "")
    })
    return allMatch ? textNodes[0].getStyle() : null
  }

  #highlightColorsMatch(style1, style2) {
    const s1 = this.#extractHighlightFromCSS(style1) || {}
    const s2 = this.#extractHighlightFromCSS(style2) || {}
    return (s1.color || "") === (s2.color || "") &&
      (s1["background-color"] || "") === (s2["background-color"] || "")
  }

  // Check if a node is inside a list item whose immediate parent has the
  // same highlight color — if so, Enter should retain the color.
  #shouldRetainHighlightFromParent(node, currentStyle) {
    let current = node
    while (current) {
      if ($isListItemNode(current)) {
        const parentColor = this.#getImmediateParentHighlight(current)
        return parentColor !== null && this.#highlightColorsMatch(currentStyle, parentColor)
      }
      current = current.getParent()
    }
    return false
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
              const anchor = selection.anchor.getNode()
              let listItem = $isListItemNode(anchor) ? anchor : null
              if (!listItem) {
                let current = anchor.getParent()
                while (current && !$isListItemNode(current)) current = current.getParent()
                listItem = current
              }
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
      return event.target.closest("lexxy-node-delete-button")
    }

    const onMouseDown = (event) => {
      const decorator = event.target.closest(".horizontal-divider")
      if (!decorator || isNodeControlClick(event)) return

      event.stopPropagation()

      const blockElement = this.#findBlockElementFromDOM(decorator)
      if (blockElement) {
        const nodeKey = this.#getNodeKeyFromElement(blockElement)
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

    this.root?.addEventListener("mousedown", onMouseDown, true)
    this.root?.addEventListener("mouseup", suppressIfDecorator, true)
    this.root?.addEventListener("click", suppressIfDecorator, true)
    this.#cleanupFns.push(() => {
      this.root?.removeEventListener("mousedown", onMouseDown, true)
      this.root?.removeEventListener("mouseup", suppressIfDecorator, true)
      this.root?.removeEventListener("click", suppressIfDecorator, true)
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
      const nodeKey = this.#getNodeKeyFromElement(blockElement)
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
      const nodeKey = this.#getNodeKeyFromElement(blockElement)
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

  #getNodeKeyFromElement(element) {
    const keyProp = Object.keys(element).find(k => k.startsWith("__lexicalKey_"))
    if (keyProp) return element[keyProp]
    return element.dataset?.lexicalNodeKey || null
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
