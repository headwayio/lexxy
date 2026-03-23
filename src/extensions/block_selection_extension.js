import LexxyExtension from "./lexxy_extension"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $parseSerializedNode,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  HISTORY_MERGE_TAG,
  INDENT_CONTENT_COMMAND,
  KEY_ESCAPE_COMMAND,
  OUTDENT_CONTENT_COMMAND
} from "lexical"
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from "@lexical/list"
import { BlockDragAndDrop } from "../editor/block_drag_and_drop"

export class BlockSelectionExtension extends LexxyExtension {
  #mode = "edit"
  #selectedBlockKeys = new Set()
  #previousSelectedKeys = new Set()
  #anchorKey = null
  #focusKey = null
  #savedSelection = null
  #dragAndDrop = null
  #cleanupFns = []
  #wrappedBlockKeys = new Set() // ListItemNode keys created by block movement
  #blockActionsMenu = null
  #deleteNeighbors = null // { next, prev } keys after a delete, for arrow key navigation
  #deferredPlacement = null

  get enabled() {
    return this.editorElement.supportsRichText
  }

  get editor() {
    return this.editorElement.editor
  }

  get root() {
    return this.editor.getRootElement()
  }

  get isBlockSelectMode() {
    return this.#mode === "block-select"
  }

  initializeEditor() {
    this.#registerEscapeHandler()
    this.#registerClickHandler()
    this.#registerDirectKeydownHandler()
    this.#dragAndDrop = new BlockDragAndDrop(this.editor, this.editorElement, this)
  }

  destroy() {
    this.#exitBlockSelectMode()
    this.#dragAndDrop?.destroy()
    for (const fn of this.#cleanupFns) fn()
    this.#cleanupFns = []
  }

  // -- Mode transitions -------------------------------------------------------

  enterBlockSelectMode(nodeKey) {
    if (this.#mode === "block-select" && this.#selectedBlockKeys.has(nodeKey)) return

    this.editor.getEditorState().read(() => {
      if (this.#mode === "edit") {
        this.#savedSelection = $getSelection()
      }
    })

    this.#mode = "block-select"
    this.root?.classList.add("block-selection-active")

    // Clear Lexical selection but keep the root element focusable
    this.editor.update(() => {
      $setSelection(null)
    })

    // Ensure the editor root stays focused for keydown events
    this.root?.focus()

    this.#selectBlock(nodeKey)
  }

  #exitBlockSelectMode() {
    if (this.#mode !== "block-select") return

    this.#mode = "edit"
    this.root?.classList.remove("block-selection-active")
    this.#clearAllSelections()
  }

  // -- Selection management ---------------------------------------------------

  #selectBlock(nodeKey, extend = false) {
    this.#deleteNeighbors = null
    if (!extend) {
      this.#previousSelectedKeys = new Set(this.#selectedBlockKeys)
      this.#selectedBlockKeys.clear()
      this.#anchorKey = nodeKey
    }

    this.#selectedBlockKeys.add(nodeKey)
    this.#focusKey = nodeKey

    if (extend && this.#anchorKey) {
      this.#selectRange(this.#anchorKey, nodeKey)
    }

    this.#syncSelectionClasses()
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
          el.classList.remove("block--selected", "block--focused")
        }
      }
    }

    for (const key of this.#selectedBlockKeys) {
      const el = this.editor.getElementByKey(key)
      if (el) {
        el.classList.add("block--selected")
        el.classList.toggle("block--focused", key === this.#focusKey)
      }
    }

    // Remove focused from non-focus keys
    for (const key of this.#selectedBlockKeys) {
      if (key !== this.#focusKey) {
        const el = this.editor.getElementByKey(key)
        if (el) el.classList.remove("block--focused")
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
      if ($isListItemNode(child)) {
        keys.push(child.getKey())
        for (const grandchild of child.getChildren()) {
          if ($isListNode(grandchild)) {
            keys.push(grandchild.getKey())
            this.#collectListItemKeys(grandchild, keys)
          }
        }
      }
    }
  }

  #getNextBlockKey(currentKey) {
    const allKeys = this.#getDocumentOrderBlockKeys()
    const index = allKeys.indexOf(currentKey)
    if (index === -1 || index >= allKeys.length - 1) return null
    return allKeys[index + 1]
  }

  #getPreviousBlockKey(currentKey) {
    const allKeys = this.#getDocumentOrderBlockKeys()
    const index = allKeys.indexOf(currentKey)
    if (index <= 0) return null
    return allKeys[index - 1]
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

  // Direct keydown listener on the editor element — works even when Lexical
  // selection is null (block-select mode clears it). Lexical's command system
  // doesn't dispatch key commands when selection is null, so we bypass it.
  #registerDirectKeydownHandler() {
    const handler = this.#handleKeydown.bind(this)
    // Listen on the editor element (captures events from the contenteditable root)
    this.editorElement.addEventListener("keydown", handler, true)
    this.#cleanupFns.push(() => {
      this.editorElement.removeEventListener("keydown", handler, true)
    })
  }

  #isPromptOpen() {
    return !!this.editorElement.querySelector("lexxy-prompt[open]")
  }

  #handleKeydown(event) {
    if (!this.isBlockSelectMode) return
    if (this.#isPromptOpen()) return

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault()
        event.stopPropagation()
        if (event.metaKey && event.shiftKey) {
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
        if (event.metaKey && event.shiftKey) {
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
    }
  }

  #handleEscape(event) {
    if (this.#isPromptOpen()) return false

    if (this.isBlockSelectMode) {
      this.#exitBlockSelectMode()
      if (this.#savedSelection) {
        this.editor.update(() => {
          $setSelection(this.#savedSelection)
        })
        this.#savedSelection = null
      }
      this.editor.focus()
      return true
    }

    // Enter block-select mode from edit mode
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

    const lastSelectedIdx = Math.max(...[...selectedSet].map(k => allKeys.indexOf(k)))
    for (let i = lastSelectedIdx + 1; i < allKeys.length; i++) {
      if (!selectedSet.has(allKeys[i])) { nextKey = allKeys[i]; break }
    }
    const firstSelectedIdx = Math.min(...[...selectedSet].map(k => allKeys.indexOf(k)))
    for (let i = firstSelectedIdx - 1; i >= 0; i--) {
      if (!selectedSet.has(allKeys[i])) { prevKey = allKeys[i]; break }
    }

    this.editor.update(() => {
      for (const key of this.#selectedBlockKeys) {
        const node = $getNodeByKey(key)
        if (node) {
          const root = $getRoot()
          if (root.getChildrenSize() <= 1 && node.getParent() === root) continue
          node.remove()
        }
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

    const anchorRect = focusedEl.getBoundingClientRect()
    this.#blockActionsMenu.show({
      anchorRect,
      editorElement: this.editorElement,
      onAction: (action) => this.#handleBlockAction(action),
      onClose: () => this.root?.focus()
    })

    this.#blockActionsMenu.focus()
  }

  #handleBlockAction(action) {
    switch (action.type) {
      case "turn-into":
        this.#withTemporarySelection(() => {
          this.editor.dispatchCommand(action.command)
        })
        break

      case "color":
        this.#withTemporarySelection(() => {
          this.editor.dispatchCommand("toggleHighlight", { [action.style]: action.value })
        })
        break

      case "remove-color":
        this.#withTemporarySelection(() => {
          this.editor.dispatchCommand("removeHighlight")
        })
        break

      case "duplicate":
        this.#handleDuplicate()
        break

      case "delete":
        this.#handleDelete()
        break
    }
  }

  // Create a temporary RangeSelection over selected blocks, run the callback,
  // then restore null selection for block select mode.
  #withTemporarySelection(callback) {
    this.editor.update(() => {
      const keys = [...this.#selectedBlockKeys]
      if (keys.length === 0) return

      const firstNode = $getNodeByKey(keys[0])
      const lastNode = $getNodeByKey(keys[keys.length - 1])
      if (!firstNode) return

      // Select from start of first block to end of last block
      if (firstNode.selectStart) firstNode.selectStart()
      else if (firstNode.select) firstNode.select()

      const selection = $getSelection()
      if ($isRangeSelection(selection) && lastNode) {
        if (lastNode.selectEnd) {
          const endSelection = lastNode.selectEnd()
          if (endSelection) {
            selection.focus.set(
              endSelection.focus.key,
              endSelection.focus.offset,
              endSelection.focus.type
            )
          }
        }
      }

      callback()

      $setSelection(null)
    }, { tag: HISTORY_MERGE_TAG })

    requestAnimationFrame(() => this.#syncSelectionClasses())
  }

  #handleDuplicate() {
    this.editor.update(() => {
      const allKeys = this.#getDocumentOrderBlockKeys()
      const sortedKeys = [...this.#selectedBlockKeys].sort(
        (a, b) => allKeys.indexOf(a) - allKeys.indexOf(b)
      )

      const newKeys = []
      // Insert clones after the LAST selected block so the group stays together
      let insertAfterNode = $getNodeByKey(sortedKeys[sortedKeys.length - 1])

      for (const key of sortedKeys) {
        const node = $getNodeByKey(key)
        if (!node) continue

        const clone = $parseSerializedNode(node.exportJSON())
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

    requestAnimationFrame(() => this.#syncSelectionClasses())
  }

  #handleIndentOutdent(outdent) {
    this.editor.update(() => {
      // Find all selected list items
      const listItemKeys = [...this.#selectedBlockKeys].filter(key => {
        const node = $getNodeByKey(key)
        return node && $isListItemNode(node)
      })
      if (listItemKeys.length === 0) return

      // Temporarily create a RangeSelection covering the list items
      // so Lexical's indent/outdent command handlers can find them.
      const firstNode = $getNodeByKey(listItemKeys[0])
      const lastNode = $getNodeByKey(listItemKeys[listItemKeys.length - 1])
      if (!firstNode) return

      firstNode.selectStart()
      const selection = $getSelection()
      if ($isRangeSelection(selection) && lastNode) {
        selection.focus.set(lastNode.getKey(), lastNode.getChildrenSize(), "element")
      }

      this.editor.dispatchCommand(
        outdent ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND
      )

      // Restore null selection for block select mode
      $setSelection(null)
    }, { tag: HISTORY_MERGE_TAG })

    requestAnimationFrame(() => {
      this.#syncSelectionClasses()
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
    const selectedKeys = [...this.#selectedBlockKeys]
    if (selectedKeys.length === 0) return

    const allKeys = this.#getDocumentOrderBlockKeys()
    selectedKeys.sort((a, b) => allKeys.indexOf(a) - allKeys.indexOf(b))

    this.editor.update(() => {
      if (direction === "up") {
        for (const key of selectedKeys) {
          this.#moveSingleBlock(key, "up")
        }
      } else {
        for (let i = selectedKeys.length - 1; i >= 0; i--) {
          this.#moveSingleBlock(selectedKeys[i], "down")
        }
      }
      // Re-sync wrapped keys with current selection after all moves.
      // Lexical's copy-on-write may have changed keys during the update.
      this.#resyncWrappedKeys()
    }, { tag: HISTORY_MERGE_TAG })

    requestAnimationFrame(() => {
      this.#syncSelectionClasses()
      this.#syncWrappedBlockAttributes()
    })
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
    while (sibling && $isListItemNode(sibling) && this.#isStructuralWrapper(sibling)) {
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
      if ($isListItemNode(child) && !this.#isStructuralWrapper(child)) {
        count++
      }
    }
    return count
  }

  // A structural wrapper is a ListItemNode whose only children are ListNodes
  // (no text content — it just holds nested lists)
  #isStructuralWrapper(listItemNode) {
    const children = listItemNode.getChildren()
    return children.length > 0 && children.every(c => $isListNode(c))
  }

  // Nest a list item as a child of an adjacent sibling.
  // Moving UP → become the LAST child of the previous sibling's nested list.
  // Moving DOWN → become the FIRST child of the next sibling's nested list.
  //
  // Lexical's list structure uses a SEPARATE structural wrapper ListItemNode
  // (with class "lexxy-nested-listitem") to hold nested lists. The text
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
        && this.#isStructuralWrapper(wrapperCandidate)
        && !wrapperCandidate.is(node)) {
      for (const child of wrapperCandidate.getChildren()) {
        if ($isListNode(child)) {
          nestedList = child
          break
        }
      }
    }

    const nodeKey = node.getKey()

    // Check if moving the node will empty its parent list BEFORE the move.
    // If so, save the structural wrapper key so we can destroy it after.
    const sourceList = node.getParent()
    let sourceWrapperKey = null
    if (sourceList && $isListNode(sourceList) && this.#countRealItems(sourceList) <= 1) {
      const sourceWrapper = sourceList.getParent()
      if (sourceWrapper && $isListItemNode(sourceWrapper) && this.#isStructuralWrapper(sourceWrapper)) {
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

    // Destroy the old structural wrapper if the move emptied its list
    if (sourceWrapperKey) {
      this.#forceDestroyWrapper(sourceWrapperKey)
    }
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

      const newList = $createListNode(currentList.getListType())
      newList.append(node)

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
      while (candidate && $isListItemNode(candidate) && this.#isStructuralWrapper(candidate)) {
        candidate = candidate.getNextSibling()
      }
      if (candidate && $isListItemNode(candidate) && !this.#isStructuralWrapper(candidate)) {
        targetSibling = candidate
      }
    } else {
      // Look for the prev real item before the owner at root level
      if (ownerItem && $isListItemNode(ownerItem) && !this.#isStructuralWrapper(ownerItem)) {
        let candidate = ownerItem.getPreviousSibling()
        while (candidate && $isListItemNode(candidate) && this.#isStructuralWrapper(candidate)) {
          candidate = candidate.getPreviousSibling()
        }
        if (candidate && $isListItemNode(candidate) && !this.#isStructuralWrapper(candidate)) {
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
        for (const child of [...listItemNode.getChildren()]) {
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

    if ($isListNode(sibling)) {
      if ($isListNode(node)) {
        // List merging into adjacent list: extract items and insert as
        // siblings at the boundary. Regular list items enter at the same
        // level, not nested.
        const items = [...node.getChildren()]

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
      if ($isListItemNode(child) && !this.#isStructuralWrapper(child)) {
        return child
      }
    }
    return null
  }

  #findLastRealItem(listNode) {
    const children = listNode.getChildren()
    for (let i = children.length - 1; i >= 0; i--) {
      if ($isListItemNode(children[i]) && !this.#isStructuralWrapper(children[i])) {
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

  #cleanupEmptyList(listNode) {
    if (!$isListNode(listNode)) return

    // Resolve the latest version — Lexical's copy-on-write creates new
    // instances when the tree is mutated, so our reference may be stale.
    const latest = $getNodeByKey(listNode.getKey())
    if (!latest || !$isListNode(latest)) return
    listNode = latest

    // If the list has no parent, it was already removed
    if (!listNode.getParent()) return

    // Prune empty ListItemNodes that Lexical normalization may have inserted
    // (containing only a LineBreakNode / <br>) to keep a list valid.
    for (const child of [...listNode.getChildren()]) {
      if ($isListItemNode(child) && !this.#isStructuralWrapper(child)
          && child.getTextContent().trim() === "") {
        child.remove()
      }
    }

    // Clean up lists that are empty OR only contain structural wrappers
    if (this.#countRealItems(listNode) > 0) return

    // Remove any leftover structural wrappers
    for (const child of listNode.getChildren()) {
      child.remove()
    }

    // If the list is inside a structural wrapper, destroy the wrapper
    // (which takes the list with it). Otherwise just remove the list.
    const parent = listNode.getParent()
    if ($isListItemNode(parent) && this.#isStructuralWrapper(parent)) {
      this.#forceDestroyWrapper(parent.getKey())
    } else {
      listNode.remove()
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

  // -- Click handling ---------------------------------------------------------

  #registerClickHandler() {
    this.#cleanupFns.push(
      this.editor.registerCommand(CLICK_COMMAND, this.#handleClick.bind(this), COMMAND_PRIORITY_HIGH)
    )
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

    if (this.isBlockSelectMode) {
      this.#exitBlockSelectMode()
      return false
    }

    return false
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
