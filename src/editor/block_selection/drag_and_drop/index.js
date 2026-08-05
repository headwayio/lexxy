import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isParagraphNode
} from "lexical"
import { $createListItemNode, $createListNode, $getListDepth, $isListItemNode, $isListNode, ListNode } from "@lexical/list"
import { $getNearestNodeOfType } from "@lexical/utils"
import { createElement } from "../../../helpers/html_helper"
import { $isStructuralWrapper, DEFAULT_ADD_BUTTON_WIDTH, DEFAULT_HANDLE_HEIGHT, DEFAULT_ROOT_PADDING, HANDLE_CONTENT_GAP, NESTED_LISTITEM_CLASS, getNodeKeyFromElement } from "../../block_helpers"
import { DragGhost } from "./ghost"
import { AutoScroll } from "./autoscroll"
import { DropIndicator } from "./drop_indicator"
import { findNearestSnapPoint, getElementNestingDepth, nextContentSibling, previousContentSibling } from "./geometry"

const GRIP_ICON = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <circle cx="2" cy="2" r="1.5"/>
  <circle cx="8" cy="2" r="1.5"/>
  <circle cx="2" cy="7" r="1.5"/>
  <circle cx="8" cy="7" r="1.5"/>
  <circle cx="2" cy="12" r="1.5"/>
  <circle cx="8" cy="12" r="1.5"/>
</svg>`

const ADD_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
  <line x1="7" y1="1" x2="7" y2="13"/>
  <line x1="1" y1="7" x2="13" y2="7"/>
</svg>`

// Minimum pointer movement (px) before a handle pointerdown becomes a drag
const DRAG_THRESHOLD = 5

export class BlockDragAndDrop {
  #editor
  #editorElement
  #blockSelectionExtension
  #handleElement = null
  #addButtonElement = null
  #dropIndicator = null
  #ghost = null
  #currentHoveredBlock = null
  #isDragging = false
  #isPendingDrag = false
  #pointerStartX = 0
  #pointerStartY = 0
  #pendingNodeKey = null
  #draggedNodeKey = null
  #wasGrabbedItemAlreadySelected = false
  #pendingExistingLIKeys = new Set()
  #pendingSourceListKey = null
  #rafId = null
  #dropTarget = null
  #hideTimer = null
  #cleanupFns = []
  #autoScroll = null
  #lastPointerX = 0
  #lastPointerY = 0
  #showHandles = true
  #hoverSuppressed = false
  // Per-drag caches: snap-point pixel positions for list containers and the
  // root's effective left edge. The DOM doesn't move during a drag, so these
  // values are invariant — populated lazily in #getDropSnapPoints on first
  // hit and cleared in #endDrag. Avoids ~N getBoundingClientRect reads per
  // RAF on docs with deeply nested lists.
  #rootSnapLeft = null
  #listLeftCache = new WeakMap()

  constructor(editor, editorElement, blockSelectionExtension) {
    this.#editor = editor
    this.#editorElement = editorElement
    this.#blockSelectionExtension = blockSelectionExtension
    this.#ghost = new DragGhost(editorElement)
    this.#autoScroll = new AutoScroll(editorElement, {
      getPointer: () => ({ x: this.#lastPointerX, y: this.#lastPointerY, isDragging: this.#isDragging }),
      onScroll: (x, y) => this.#updateDropIndicator({ clientX: x, clientY: y })
    })

    // Drag handles shown by default. Set block-handles="false" on <lexxy-editor>
    // to hide them (compact editors like comments/chat that don't need drag UX).
    this.#showHandles = editorElement.getAttribute("block-handles") !== "false"

    if (this.#showHandles) {
      this.#createAddButton()
      this.#createHandleElement()
    }
    this.#dropIndicator = new DropIndicator(editorElement)

    this.#registerListeners()
  }

  /**
   * Show or hide drag handles at runtime. Called when the block-handles
   * attribute changes on <lexxy-editor> (e.g. expanding a compact chat
   * input into a full editor).
   */
  setShowHandles(show) {
    if (show === this.#showHandles) return
    this.#showHandles = show

    if (show) {
      if (!this.#addButtonElement) this.#createAddButton()
      if (!this.#handleElement) this.#createHandleElement()
    } else {
      this.#addButtonElement?.remove()
      this.#addButtonElement = null
      this.#handleElement?.remove()
      this.#handleElement = null
    }
  }

  // Re-position handle/bullet on the currently hovered block (e.g., after
  // Tab indent changes the block's DOM position). Looks up the fresh DOM
  // element by node key since Lexical may have recreated the element.
  repositionHandle() {
    if (!this.#currentHoveredBlock) return
    const nodeKey = getNodeKeyFromElement(this.#currentHoveredBlock)
    if (nodeKey) {
      const freshEl = this.#editor.getElementByKey(nodeKey)
      if (freshEl && freshEl !== this.#currentHoveredBlock) {
        this.#currentHoveredBlock.classList.remove("lexxy-block-hovered")
        this.#currentHoveredBlock = freshEl
      }
    }
    this.#positionHandle(this.#currentHoveredBlock)
  }

  destroy() {
    this.#cleanup()
    this.#cancelHideTimer()
    this.#addButtonElement?.remove()
    this.#handleElement?.remove()
    this.#dropIndicator?.destroy()
    for (const fn of this.#cleanupFns) fn()
    this.#cleanupFns = []
  }

  // -- Handle element ---------------------------------------------------------

  #createAddButton() {
    this.#editorElement.querySelector(".lexxy-block-add")?.remove()

    const btn = createElement("div", {
      className: "lexxy-block-add",
      "aria-label": "Add block"
    })
    btn.innerHTML = ADD_ICON

    btn.addEventListener("click", this.#onAddButtonClick)

    this.#addButtonElement = btn
    this.#editorElement.appendChild(btn)
  }

  #onAddButtonClick = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!this.#currentHoveredBlock) return

    const nodeKey = getNodeKeyFromElement(this.#currentHoveredBlock)
    if (!nodeKey) return

    this.#editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!node) return

      const paragraph = $createParagraphNode()
      node.insertAfter(paragraph)

      // Focus the new paragraph
      paragraph.selectEnd()
    })
  }

  #createHandleElement() {
    this.#editorElement.querySelector(".lexxy-block-handle")?.remove()

    this.#handleElement = createElement("div", {
      className: "lexxy-block-handle",
      "aria-hidden": "true"
    })
    this.#handleElement.innerHTML = GRIP_ICON

    this.#handleElement.addEventListener("pointerdown", this.#onHandlePointerDown)

    this.#editorElement.appendChild(this.#handleElement)
  }

  #positionHandle(blockElement) {
    if (!this.#showHandles || !this.#handleElement || !blockElement) return
    this.#cancelHideTimer()
    blockElement.classList.add("lexxy-block-hovered")

    const editorRect = this.#editorElement.getBoundingClientRect()
    const handleHeight = this.#handleElement.offsetHeight || DEFAULT_HANDLE_HEIGHT
    const handleWidth = this.#handleElement.offsetWidth || DEFAULT_ADD_BUTTON_WIDTH

    const blockRect = blockElement.getBoundingClientRect()
    let top

    if (blockElement.tagName === "LI") {
      const handleCenter = this.#calculateListItemCenter(blockElement, blockRect)
          ?? (blockRect.top + (parseFloat(getComputedStyle(blockElement).lineHeight) || DEFAULT_HANDLE_HEIGHT) / 2 - 1)

      top = handleCenter - editorRect.top - (handleHeight / 2)

      // --bullet-offset-y positions a ::before box so its center aligns with
      // handleCenter. The radial-gradient dot is centered in the box.
      const bulletTop = handleCenter - blockRect.top - (DEFAULT_HANDLE_HEIGHT / 2)
      if (Math.abs(bulletTop) > 1) {
        blockElement.style.setProperty("--bullet-offset-y", `${bulletTop}px`)
      } else {
        blockElement.style.removeProperty("--bullet-offset-y")
      }
    } else if (blockElement.matches("table, .lexxy-content__table-wrapper")) {
      // Tables: center on the first row
      const firstRow = blockElement.querySelector("tr")
      if (firstRow) {
        const rowRect = firstRow.getBoundingClientRect()
        const rowCenter = rowRect.top + (rowRect.height / 2) - 1
        top = rowCenter - editorRect.top - (handleHeight / 2)
      } else {
        top = blockRect.top - editorRect.top
      }
    } else if (this.#isTopAlignedBlock(blockElement)) {
      // Uploads: handle at the top edge of the block
      top = blockRect.top - editorRect.top
    } else if (blockElement.matches("pre, code[data-language]")) {
      // Code blocks: center in the language-selector row
      const paddingTop = parseFloat(getComputedStyle(blockElement).paddingTop) || 0
      const rowCenter = blockRect.top + (paddingTop / 2)
      top = rowCenter - editorRect.top - (handleHeight / 2)
    } else {
      // Everything else: center on the first character of text
      // -1: font ascent places the visual center slightly above charRect midpoint
      const firstCharRect = this.#getFirstCharRect(blockElement)
      if (firstCharRect && firstCharRect.height > 0) {
        const lineCenter = firstCharRect.top + (firstCharRect.height / 2) - 1
        top = lineCenter - editorRect.top - (handleHeight / 2)
      } else {
        // No text (HR, empty blocks): center vertically on the block
        const blockCenter = blockRect.top + (blockRect.height / 2)
        top = blockCenter - editorRect.top - (handleHeight / 2)
      }
    }

    // Position horizontally to the left of the block's visual start (including
    // bullet markers for list items). Like Notion, the handle sits to the left
    // of bullets/numbers, not overlapping them.
    const contentLeft = this.#getBlockVisualLeft(blockElement)
    const addWidth = this.#addButtonElement?.offsetWidth || DEFAULT_ADD_BUTTON_WIDTH
    const gap = 1 // gap between + and ⠿
    const left = contentLeft - editorRect.left - handleWidth - HANDLE_CONTENT_GAP

    this.#handleElement.style.top = `${top}px`
    this.#handleElement.style.left = `${left}px`
    this.#handleElement.classList.add("lexxy-block-handle--visible")

    // Position the + button to the left of the drag handle
    if (this.#addButtonElement) {
      this.#addButtonElement.style.top = `${top}px`
      this.#addButtonElement.style.left = `${left - addWidth - gap}px`
      this.#addButtonElement.classList.add("lexxy-block-add--visible")
    }
  }

  // Determine the vertical center (viewport Y) for a list item's wrapped
  // content. Returns null for regular text list items that don't need a
  // custom center (the default lineHeight/2 center is fine). Shared by
  // both #positionHandle (drag handle) and syncBulletOffset (bullet dot).
  #calculateListItemCenter(blockElement, blockRect) {
    const innerHR = blockElement.querySelector(".horizontal-divider, hr")
    const innerTable = blockElement.querySelector("table, .lexxy-content__table-wrapper")
    const innerAttachment = blockElement.querySelector("figure.attachment, .attachment-gallery, .attachment")
    const innerHeading = blockElement.querySelector("h1, h2, h3, h4, h5, h6")
    const innerCode = blockElement.querySelector("pre, code[data-language]")
    const innerBlockquote = !innerCode ? blockElement.querySelector("blockquote") : null

    if (innerHR) {
      const hrLine = innerHR.tagName === "HR" ? innerHR : innerHR.querySelector("hr")
      const hrRect = (hrLine || innerHR).getBoundingClientRect()
      return hrRect.top + (hrRect.height / 2) - 1
    }

    if (innerTable) {
      const firstRow = innerTable.querySelector("tr")
      if (firstRow) {
        const rowRect = firstRow.getBoundingClientRect()
        return rowRect.top + (rowRect.height / 2) - 1
      }
    }

    if (innerAttachment) {
      return innerAttachment.getBoundingClientRect().top + (DEFAULT_HANDLE_HEIGHT / 2)
    }

    if (innerHeading) {
      const charRect = this.#getFirstCharRect(innerHeading)
      if (charRect && charRect.height > 0) {
        return charRect.top + (charRect.height / 2) - 1
      }
    }

    if (innerCode) {
      const codeRect = innerCode.getBoundingClientRect()
      const paddingTop = parseFloat(getComputedStyle(innerCode).paddingTop) || 0
      return codeRect.top + (paddingTop / 2)
    }

    if (innerBlockquote) {
      const charRect = this.#getFirstCharRect(innerBlockquote)
      if (charRect && charRect.height > 0) {
        return charRect.top + (charRect.height / 2)
      }
    }

    // Regular text list item — no custom center needed
    return null
  }

  // Compute and set --bullet-offset-y on a list item so the bullet ::before
  // aligns with the content center (same calculation as #positionHandle).
  // Called from block_selection_extension after keyboard moves and turn-into.
  syncBulletOffset(blockElement) {
    if (!blockElement || blockElement.tagName !== "LI") return

    const blockRect = blockElement.getBoundingClientRect()
    const handleCenter = this.#calculateListItemCenter(blockElement, blockRect)

    if (handleCenter === null) {
      // Regular text list item — no offset needed
      blockElement.style.removeProperty("--bullet-offset-y")
      return
    }

    // --bullet-offset-y positions a ::before box so its center aligns with
    // handleCenter. The radial-gradient dot is centered in the box.
    const bulletTop = handleCenter - blockRect.top - (DEFAULT_HANDLE_HEIGHT / 2)
    if (Math.abs(bulletTop) > 1) {
      blockElement.style.setProperty("--bullet-offset-y", `${bulletTop}px`)
    } else {
      blockElement.style.removeProperty("--bullet-offset-y")
    }
  }

  // Suppress hover-driven handle positioning during keyboard moves to prevent
  // stale layout measurements from racing with the double-rAF sync.
  suppressHover() {
    this.#hoverSuppressed = true
    // Hide handle immediately so stale positions don't flash
    if (this.#handleElement) {
      this.#handleElement.classList.remove("lexxy-block-handle--visible")
    }
    if (this.#addButtonElement) {
      this.#addButtonElement.classList.remove("lexxy-block-add--visible")
    }
    this.#currentHoveredBlock?.classList.remove("lexxy-block-hovered")
    this.#currentHoveredBlock = null
  }

  unsuppressHover() {
    this.#hoverSuppressed = false
  }

  // Get the visual left edge of a block for handle/indicator positioning.
  // For all list items, account for the bullet ::before area so handles
  // sit to the left of the bullet marker.
  #getBlockVisualLeft(blockElement) {
    if (blockElement.tagName === "LI") {
      // Use the parent UL/OL's left edge — same as a paragraph at the
      // same nesting level. The bullet sits between handle and text.
      const parentList = blockElement.closest("ul, ol")
      if (parentList) return parentList.getBoundingClientRect().left
    }
    return blockElement.getBoundingClientRect().left
  }

  // Blocks that should have handle at their top edge rather than centered
  #isTopAlignedBlock(element) {
    return element.matches("table, .lexxy-content__table-wrapper") ||
           element.querySelector(":scope > .attachment, :scope > figure.attachment") !== null ||
           element.classList.contains("attachment-gallery") ||
           element.classList.contains("attachment")
  }

  #getFirstCharRect(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let textNode = walker.nextNode()
    while (textNode && !textNode.textContent.trim()) {
      textNode = walker.nextNode()
    }
    if (!textNode) return null

    const range = document.createRange()
    const offset = textNode.textContent.search(/\S/)
    range.setStart(textNode, offset >= 0 ? offset : 0)
    range.setEnd(textNode, (offset >= 0 ? offset : 0) + 1)
    return range.getBoundingClientRect()
  }

  #hideHandle() {
    // Delay hiding so the user has time to move from the block to the handle
    this.#cancelHideTimer()
    this.#hideTimer = setTimeout(() => {
      this.#hideTimer = null
      if (this.#handleElement) {
        this.#handleElement.classList.remove("lexxy-block-handle--visible")
      }
      if (this.#addButtonElement) {
        this.#addButtonElement.classList.remove("lexxy-block-add--visible")
      }
      this.#currentHoveredBlock?.classList.remove("lexxy-block-hovered")
      this.#currentHoveredBlock = null
    }, 300)
  }

  #cancelHideTimer() {
    if (this.#hideTimer) {
      clearTimeout(this.#hideTimer)
      this.#hideTimer = null
    }
  }

  // -- Hover detection --------------------------------------------------------

  #registerListeners() {
    const root = this.#editor.getRootElement()
    if (!root) {
      const unregister = this.#editor.registerRootListener((newRoot, prevRoot) => {
        if (prevRoot) {
          prevRoot.removeEventListener("mousemove", this.#onMouseMove)
          prevRoot.removeEventListener("mouseleave", this.#onMouseLeave)
        }
        if (newRoot) {
          newRoot.addEventListener("mousemove", this.#onMouseMove)
          newRoot.addEventListener("mouseleave", this.#onMouseLeave)
        }
      })
      this.#cleanupFns.push(unregister)
    } else {
      root.addEventListener("mousemove", this.#onMouseMove)
      root.addEventListener("mouseleave", this.#onMouseLeave)
      this.#cleanupFns.push(() => {
        root.removeEventListener("mousemove", this.#onMouseMove)
        root.removeEventListener("mouseleave", this.#onMouseLeave)
      })
    }

    // Hide handle when mouse leaves the entire editor element (including the
    // handle/add button gutter area). The root mouseleave suppresses hiding
    // when moving to the handle, but nothing catches leaving the handle itself.
    this.#editorElement.addEventListener("mouseleave", this.#onEditorElementLeave)
    this.#cleanupFns.push(() => {
      this.#editorElement.removeEventListener("mouseleave", this.#onEditorElementLeave)
    })

    // Hide handles during keyboard input (typing, Enter, Backspace).
    // They reappear on the next mouse move, like Notion.
    this.#editorElement.addEventListener("keydown", this.#onKeydownHideHandle)
    this.#cleanupFns.push(() => {
      this.#editorElement.removeEventListener("keydown", this.#onKeydownHideHandle)
    })
  }

  /** Immediately hide handles (no delay). Used when keyboard takes over. */
  hideHandles() {
    this.#cancelHideTimer()
    if (this.#handleElement) {
      this.#handleElement.classList.remove("lexxy-block-handle--visible")
    }
    if (this.#addButtonElement) {
      this.#addButtonElement.classList.remove("lexxy-block-add--visible")
    }
    this.#currentHoveredBlock?.classList.remove("lexxy-block-hovered")
    this.#currentHoveredBlock = null
  }

  #onKeydownHideHandle = (event) => {
    if (this.#isDragging || this.#isPendingDrag) return
    // Don't hide on modifier-only keypresses (Cmd, Alt, Ctrl, Shift)
    if (event.key === "Meta" || event.key === "Alt" || event.key === "Control" || event.key === "Shift") return
    this.hideHandles()
  }

  #onMouseMove = (event) => {
    if (this.#isDragging) return

    if (!this.#rafId) {
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null
        this.#updateHoveredBlock(event)
      })
    }
  }

  #onEditorElementLeave = () => {
    if (!this.#isDragging) {
      this.#hideHandle()
    }
  }

  #onMouseLeave = (event) => {
    // Don't hide when the mouse moves from the content area to the drag handle —
    // the handle is a sibling of the content root, so mouseleave fires, but we
    // need #currentHoveredBlock to persist for the pointerdown handler.
    if (this.#isHandleOrChild(event.relatedTarget)) {
      this.#cancelHideTimer()
      return
    }
    if (!this.#isDragging) {
      this.#hideHandle()
    }
  }

  #isHandleOrChild(element) {
    return element === this.#handleElement || this.#handleElement?.contains(element) ||
           element === this.#addButtonElement || this.#addButtonElement?.contains(element)
  }

  #updateHoveredBlock(event) {
    if (this.#hoverSuppressed) return
    const root = this.#editor.getRootElement()
    if (!root) return

    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (!element || !root.contains(element)) {
      // Don't hide when hovering over the drag handle — keep #currentHoveredBlock
      if (this.#isHandleOrChild(element)) {
        this.#cancelHideTimer()
        return
      }
      this.#hideHandle()
      return
    }

    // Mouse is in the root's padding area (the gutter) — not over any block, but
    // still inside the content root. Keep the current hovered block so the handle
    // stays visible as the user moves toward it.
    if (element === root) {
      this.#cancelHideTimer()
      return
    }

    const blockElement = this.#findNearestBlockElement(element, root, event.clientY)
    if (!blockElement || blockElement === this.#currentHoveredBlock) {
      if (!blockElement) this.#hideHandle()
      return
    }

    // If the new block is an ancestor of the current hovered block (e.g., mouse
    // moved from an <li> into the parent <ul>'s padding area), keep the current
    // block. This prevents the handle from jumping when moving toward it.
    if (this.#currentHoveredBlock && blockElement.contains(this.#currentHoveredBlock)) {
      this.#cancelHideTimer()
      return
    }

    // Remove hover class from previous block before updating the reference
    if (this.#currentHoveredBlock) {
      this.#currentHoveredBlock.classList.remove("lexxy-block-hovered")
    }
    this.#currentHoveredBlock = blockElement
    this.syncBulletOffset(blockElement)
    this.#positionHandle(blockElement)
  }

  // Find the nearest selectable block element: list items, or top-level blocks.
  // When clientY is provided, resolves list gaps to the nearest child <li>
  // instead of returning the <ul> container.
  #findNearestBlockElement(element, root, clientY = null) {
    let current = element
    while (current && current !== root) {
      // List items are individually selectable blocks — but skip structural
      // wrappers (lexxy-nested-listitem) which are just containers for nested lists
      if (current.tagName === "LI" && root.contains(current) &&
          !current.classList.contains(NESTED_LISTITEM_CLASS)) {
        return current
      }
      // Top-level children of the root
      if (current.parentElement === root) {
        // If the element is a list, resolve to the nearest <li> inside it
        // to avoid jumping to root level when the mouse is in gaps.
        if (clientY !== null && (current.tagName === "UL" || current.tagName === "OL")) {
          const nearestLi = this.#findNearestListItem(current, clientY)
          if (nearestLi) return nearestLi
        }
        // Skip hidden provisional paragraphs — resolve to the nearest
        // visible sibling instead (these sit between decorator nodes to
        // allow cursor placement but aren't valid drop targets).
        if (current.hidden || current.classList.contains("hidden")) {
          return this.#nearestVisibleSibling(current, clientY)
        }
        return current
      }
      current = current.parentElement
    }
    return null
  }

  // Find the <li> inside a list that is closest to the given clientY
  #findNearestListItem(listElement, clientY) {
    let best = null
    let bestDist = Infinity

    for (const child of listElement.querySelectorAll("li")) {
      // Skip structural wrappers (only contain nested lists, no text)
      if (child.classList.contains(NESTED_LISTITEM_CLASS)) continue

      const rect = child.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const dist = Math.abs(clientY - center)
      if (dist < bestDist) {
        bestDist = dist
        best = child
      }
    }

    return best
  }

  // Resolve the effective list-marker style ("ol" or "ul") at a drop
  // target. The indicator is a continuation of the item directly ABOVE
  // the drop position — that's what the dropped item visually follows
  // from. So:
  //   - position "after X"  → use X itself (X is the item above).
  //   - position "before X" → use X's previous LI sibling (the item
  //     above the drop position, NOT X). If X is the first child of its
  //     list, fall through to closest-list tag.
  //   - position "inside X" → use X (rare; treated as a continuation
  //     of X for indicator purposes).
  // Then for the chosen target LI:
  //   1. If it has a data-wrapper-marker (wrapped block), use it —
  //      stamped by syncWrapperMarkers, source of truth.
  //   2. Otherwise (regular text LI or non-LI), use the closest list's
  //      tag (UL→bullet, OL→number).
  #effectiveListType(blockElement, closestList, position) {
    if (!blockElement) return closestList?.tagName?.toLowerCase() || null

    let target = blockElement
    if (position === "before" && blockElement.tagName === "LI") {
      let prev = blockElement.previousElementSibling
      // Skip structural-wrapper siblings (children-of-prior-item containers).
      while (prev && prev.classList.contains(NESTED_LISTITEM_CLASS)) {
        prev = prev.previousElementSibling
      }
      if (prev && prev.tagName === "LI") target = prev
    }

    const m = target.dataset?.wrapperMarker
    if (m === "number") return "ol"
    if (m === "bullet") return "ul"
    return closestList?.tagName?.toLowerCase() || null
  }

  // Is the dragged node the IMMEDIATE next sibling of `targetKey`?
  // Used to detect drop-on-own-row no-ops in #resolveDropTarget. Walks
  // through structural-wrapper LIs the same way the existing "before,
  // dragged is prev sibling" check does, so a wrapped block with a
  // children wrapper between it and the dragged item still resolves.
  #draggedIsImmediateNextSibling(targetKey) {
    let isNext = false
    this.#editor.getEditorState().read(() => {
      const targetNode = $getNodeByKey(targetKey)
      const draggedNode = $getNodeByKey(this.#draggedNodeKey)
      if (!targetNode || !draggedNode) return
      let next = targetNode.getNextSibling()
      // Skip the target's own structural wrapper (children container)
      if (next && $isStructuralWrapper(next)) next = next.getNextSibling()
      if (next && next.getKey() === this.#draggedNodeKey) isNext = true
    })
    return isNext
  }

  // Given a hidden element, find the nearest visible sibling by clientY
  #nearestVisibleSibling(element, clientY) {
    function isVisible(el) {
      return el && !el.hidden && !el.classList.contains("hidden")
    }
    let prev = element.previousElementSibling
    while (prev && !isVisible(prev)) prev = prev.previousElementSibling
    let next = element.nextElementSibling
    while (next && !isVisible(next)) next = next.nextElementSibling

    if (!prev) return next
    if (!next) return prev

    const prevDist = Math.abs(clientY - prev.getBoundingClientRect().bottom)
    const nextDist = Math.abs(clientY - next.getBoundingClientRect().top)
    return prevDist < nextDist ? prev : next
  }

  // -- Drag initiation (with click vs drag threshold) -------------------------

  #onHandlePointerDown = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!this.#currentHoveredBlock) return

    const nodeKey = getNodeKeyFromElement(this.#currentHoveredBlock)
    if (!nodeKey) return

    // Don't start dragging immediately — wait for movement threshold
    this.#isPendingDrag = true
    this.#pointerStartX = event.clientX
    this.#pointerStartY = event.clientY
    this.#pendingNodeKey = nodeKey

    // Snapshot whether the grabbed item was already part of a
    // multi-block selection. Drives two decisions:
    //   1. Below: skip the single-block enterBlockSelectMode call
    //      so multi-selection persists visually through the drag.
    //   2. After drop (in #onPendingDragEnd): preserve multi-selection
    //      instead of collapsing to just the dropped block.
    this.#wasGrabbedItemAlreadySelected =
      this.#blockSelectionExtension.isBlockSelected(nodeKey) &&
      this.#blockSelectionExtension.blockSelectionSize() > 1

    this.#handleElement.setPointerCapture(event.pointerId)

    // Select the block with children on next frame. Doing it synchronously
    // during pointerdown can trigger DOM mutations that disrupt pointer capture.
    // Skip when the grabbed item is already part of a multi-selection — entering
    // single-block mode would collapse the selection the user just made, which
    // is not what they want when grabbing one item out of many.
    if (!this.#wasGrabbedItemAlreadySelected) {
      requestAnimationFrame(() => {
        this.#blockSelectionExtension.enterBlockSelectMode(nodeKey, { keepHandles: true })
      })
    }

    document.addEventListener("pointermove", this.#onPendingDragMove)
    document.addEventListener("pointerup", this.#onPendingDragEnd)
    document.addEventListener("pointercancel", this.#onPendingDragEnd)

    // Register cleanup so that if the editor is destroyed mid-pointerdown
    // (Turbo morph, modal close, disconnectedCallback race), the pending-drag
    // listeners don't outlive the instance and fire against stale state.
    this.#cleanupFns.push(this.#removePendingDragListeners)
  }

  #removePendingDragListeners = () => {
    document.removeEventListener("pointermove", this.#onPendingDragMove)
    document.removeEventListener("pointerup", this.#onPendingDragEnd)
    document.removeEventListener("pointercancel", this.#onPendingDragEnd)
  }

  // While pending: check if we've moved far enough to start a real drag
  #onPendingDragMove = (event) => {
    if (!this.#isPendingDrag) return

    const dx = event.clientX - this.#pointerStartX
    const dy = event.clientY - this.#pointerStartY
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance >= DRAG_THRESHOLD) {
      // Exceeded threshold — transition to real drag
      this.#isPendingDrag = false
      document.removeEventListener("pointermove", this.#onPendingDragMove)
      document.removeEventListener("pointerup", this.#onPendingDragEnd)
      document.removeEventListener("pointercancel", this.#onPendingDragEnd)

      this.#startDrag(this.#pendingNodeKey, event)
    }
  }

  // Pointer released before threshold — this was a click, not a drag
  #onPendingDragEnd = () => {
    this.#isPendingDrag = false
    this.#pendingNodeKey = null

    document.removeEventListener("pointermove", this.#onPendingDragMove)
    document.removeEventListener("pointerup", this.#onPendingDragEnd)
    document.removeEventListener("pointercancel", this.#onPendingDragEnd)

    // Block is already selected from pointerdown — nothing else to do
  }

  #startDrag(nodeKey, event) {
    // Always drag the content node directly. Lexical's list normalization
    // will clean up any empty structural wrappers left behind after removal.
    this.#isDragging = true
    this.#draggedNodeKey = nodeKey
    this.#editorElement.classList.add("lexxy-block-dragging")

    // Release pointer capture from the handle — it was set during pointerdown
    // for the click-vs-drag threshold, but during drag we use document listeners.
    // Keeping capture on a hidden element can cause browsers to drop pointer events.
    try { this.#handleElement?.releasePointerCapture(event.pointerId) } catch {}

    // Clear node--selected from any previously selected elements that aren't
    // the one being dragged, so only the dragged item appears selected.
    const draggedEl = this.#editor.getElementByKey(nodeKey)
    const rootElement = this.#editor.getRootElement()
    if (rootElement) {
      for (const el of rootElement.querySelectorAll(".node--selected")) {
        if (el !== draggedEl) el.classList.remove("node--selected")
      }
    }

    // Apply visual drag state to every block participating in the drag
    // (the grabbed one + any other selected block in a multi-selection)
    // and each one's structural-wrapper sibling, so the entire moving
    // subtree fades during drag. The ghost shows the full selection
    // already; matching the dim treatment in-place tells the user
    // "all of these are going with me," not just "this one is."
    const dragEls = []
    if (this.#blockSelectionExtension.blockSelectionSize() > 1) {
      const keys = this.#blockSelectionExtension.selectedBlockKeysArray()
      for (const k of keys) {
        const e = this.#editor.getElementByKey(k)
        if (e) dragEls.push(e)
      }
    }
    if (!dragEls.includes(draggedEl)) dragEls.push(draggedEl)

    for (const el of dragEls) {
      if (!el) continue
      el.classList.add("lexxy-dragging")
      const sib = el.nextElementSibling
      if (sib && sib.classList.contains(NESTED_LISTITEM_CLASS)) {
        sib.classList.add("lexxy-dragging")
      }
    }
    const el = draggedEl // keep the original alias for code below

    // Create a floating ghost clone that follows the cursor. For
    // multi-block selections, include every selected block's element
    // so the ghost reflects the full scope of what's being dragged.
    // Filter out elements that are already descendants of another
    // selected element's subtree (the parent's cloneNode already
    // includes them — without this filter, descendants like a
    // wrapper-takeover child get duplicated in the ghost).
    let extraElements = []
    if (this.#blockSelectionExtension.blockSelectionSize() > 1) {
      const keys = this.#blockSelectionExtension.selectedBlockKeysArray()
      const candidates = keys
        .map(k => this.#editor.getElementByKey(k))
        .filter(e => e && e !== el)

      function subtreeContains(ownerEl, target) {
        if (ownerEl.contains(target)) return true
        const sib = ownerEl.nextElementSibling
        return !!(sib && sib.classList.contains(NESTED_LISTITEM_CLASS) && sib.contains(target))
      }

      extraElements = candidates.filter(c => {
        if (subtreeContains(el, c)) return false
        for (const other of candidates) {
          if (other !== c && subtreeContains(other, c)) return false
        }
        return true
      })
    }
    this.#ghost.create(el, event, extraElements)

    // Hide the handle and + button during drag
    this.#handleElement?.classList.remove("lexxy-block-handle--visible")
    this.#addButtonElement?.classList.remove("lexxy-block-add--visible")

    this.#lastPointerX = event.clientX
    this.#lastPointerY = event.clientY

    document.addEventListener("pointermove", this.#onDragMove)
    window.addEventListener("pointerup", this.#onDragEnd, true)
    window.addEventListener("pointercancel", this.#onDragEnd, true)
    window.addEventListener("mouseup", this.#onDragEnd, true)
    document.addEventListener("keydown", this.#onDragKeydown)

    this.#autoScroll.start()

    // Immediately update the drop indicator for the current position
    this.#updateDropIndicator(event)
  }

  #onDragMove = (event) => {
    if (!this.#isDragging) return

    event.preventDefault()

    this.#lastPointerX = event.clientX
    this.#lastPointerY = event.clientY

    this.#ghost.position(event)

    if (!this.#rafId) {
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null
        this.#updateDropIndicator(event)
      })
    }
  }

  // Escape cancels the drag without dropping — animate ghost back to origin
  #onDragKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      this.#cancelDragWithSnapBack()
    }
  }

  #cancelDragWithSnapBack() {
    const ghost = this.#ghost.element
    const sourceEl = this.#draggedNodeKey && this.#editor.getElementByKey(this.#draggedNodeKey)

    if (!ghost || !sourceEl) {
      this.#cleanup()
      return
    }

    // Stop responding to pointer events during the animation
    document.removeEventListener("pointermove", this.#onDragMove)
    document.removeEventListener("keydown", this.#onDragKeydown)
    this.#autoScroll.stop()
    this.#hideDropIndicator()

    const sourceRect = sourceEl.getBoundingClientRect()

    ghost.style.transition = "left 200ms ease, top 200ms ease, opacity 200ms ease"
    ghost.style.left = `${sourceRect.left}px`
    ghost.style.top = `${sourceRect.top}px`
    ghost.style.opacity = "0"

    const cleanup = () => { if (this.#isDragging) this.#cleanup() }
    ghost.addEventListener("transitionend", cleanup, { once: true })
    setTimeout(cleanup, 250)
  }

  #onDragEnd = () => {
    if (!this.#isDragging) return

    document.removeEventListener("pointermove", this.#onDragMove)
    window.removeEventListener("pointerup", this.#onDragEnd, true)
    window.removeEventListener("pointercancel", this.#onDragEnd, true)
    window.removeEventListener("mouseup", this.#onDragEnd, true)
    document.removeEventListener("keydown", this.#onDragKeydown)

    let droppedNodeKey = null
    if (this.#dropTarget && this.#draggedNodeKey) {
      try {
        droppedNodeKey = this.#draggedNodeKey
        this.#performDrop()
      } catch (e) {
        console.error("[BlockDragAndDrop] Drop failed:", e)
        droppedNodeKey = null
      }
    }

    const wasMulti = this.#wasGrabbedItemAlreadySelected
    this.#wasGrabbedItemAlreadySelected = false

    this.#cleanup()

    // After a successful drop, refresh the selection on the moved block
    // (and its children at the new location) so the user sees the full
    // scope of what landed — especially after outdenting where the
    // block may have ADOPTED new children that need to enter the
    // selection. Skip this refresh when the user grabbed one item out
    // of an existing multi-selection: they expect the multi-selection
    // to persist through the drag, not collapse to the moved block.
    // (Key remapping for the dragged item is already handled by
    // #updateKeyAfterUnwrap during the drop's editor.update.)
    if (droppedNodeKey && !wasMulti) {
      requestAnimationFrame(() => {
        this.#blockSelectionExtension.enterBlockSelectMode(droppedNodeKey)
      })
    }
  }

  // -- Drop target resolution with hierarchy levels ---------------------------

  #updateDropIndicator(event) {
    const target = this.#resolveDropTarget(event)
    this.#dropTarget = target

    if (!target) {
      this.#hideDropIndicator()
      return
    }

    this.#showDropIndicator(target)
  }

  #resolveDropTarget(event) {
    const root = this.#editor.getRootElement()
    if (!root) return null

    let element = document.elementFromPoint(event.clientX, event.clientY)

    // When the cursor is above or below all content (in toolbar area,
    // editor padding, or root padding), offer a root-level drop.
    const rootRect = root.getBoundingClientRect()
    const isAboveContent = event.clientY < rootRect.top
    const isBelowContent = event.clientY > rootRect.bottom
    if (isAboveContent || isBelowContent || element === root) {
      const children = [ ...root.children ].filter(c =>
        c.tagName !== "BR" && !c.classList.contains("lexxy-block-handle") &&
        !c.classList.contains("lexxy-block-add") &&
        !c.classList.contains("lexxy-drop-indicator"))
      if (children.length > 0) {
        const firstChild = children[0]
        const lastChild = children[children.length - 1]
        const firstRect = firstChild.getBoundingClientRect()
        const lastRect = lastChild.getBoundingClientRect()
        const rootPadding = parseFloat(getComputedStyle(root).paddingInlineStart) || DEFAULT_ROOT_PADDING
        const contentLeft = rootRect.left + rootPadding

        if (event.clientY < firstRect.top) {
          // Cursor is above ALL content → root-level "before"
          const edgeBlock = this.#findNearestBlockElement(firstChild, root, event.clientY) || firstChild
          const edgeKey = getNodeKeyFromElement(edgeBlock)
          if (edgeKey && edgeKey !== this.#draggedNodeKey) {
            return { element: edgeBlock, nodeKey: edgeKey, position: "before", depth: 0, bulletLeft: contentLeft, contentLeft }
          }
        } else if (event.clientY > lastRect.bottom) {
          // Cursor is below ALL content → root-level "after"
          const edgeBlock = this.#findNearestBlockElement(lastChild, root, event.clientY) || lastChild
          const edgeKey = getNodeKeyFromElement(edgeBlock)
          if (edgeKey && edgeKey !== this.#draggedNodeKey) {
            return { element: edgeBlock, nodeKey: edgeKey, position: "after", depth: 0, bulletLeft: contentLeft, contentLeft }
          }
        } else {
          // Cursor is in a gap within content — find nearest visible block
          // and fall through to normal resolution so depth, snap points,
          // and positions are computed consistently.
          const visibleChildren = children.filter(c => !c.hidden && !c.classList.contains("hidden"))
          let best = null, bestDist = Infinity
          for (const child of visibleChildren) {
            const cr = child.getBoundingClientRect()
            const dist = Math.min(Math.abs(event.clientY - cr.top), Math.abs(event.clientY - cr.bottom))
            if (dist < bestDist) { bestDist = dist; best = child }
          }
          if (best) element = best
        }
      }
    }

    // For normal resolution, the element must be inside the content root
    if (!element || !root.contains(element)) return null

    // Pass clientY to resolve list gaps to the nearest <li>
    const blockElement = this.#findNearestBlockElement(element, root, event.clientY)
    if (!blockElement) return null

    const resolvedBlock = blockElement
    const nodeKey = getNodeKeyFromElement(resolvedBlock)
    if (!nodeKey) return null

    // Self-targeting: allow the dragged item as its own drop target for
    // outdent-in-place (drag left on the last item in a sublist to promote
    // it without re-parenting siblings). Position is forced to "after".
    const isSelfTarget = nodeKey === this.#draggedNodeKey
    if (isSelfTarget && resolvedBlock.tagName !== "LI") return null

    // Skip drop positions adjacent to the dragged node (would be a no-op).
    // Also skip if the target is inside the dragged subtree — this includes
    // both the dragged node's descendants AND its structural wrapper (children
    // container), which is a sibling in the DOM, not a descendant.
    if (!isSelfTarget) {
      const dragRootEl = this.#editor.getElementByKey(this.#draggedNodeKey)
      if (dragRootEl) {
        if (dragRootEl.contains(resolvedBlock)) return null
        // Also check the structural wrapper (faded children sibling)
        const dragWrapper = dragRootEl.nextElementSibling
        if (dragWrapper?.classList.contains(NESTED_LISTITEM_CLASS) && dragWrapper.contains(resolvedBlock)) return null
      }
    }

    const position = isSelfTarget ? "after" : this.#computeVerticalPosition(resolvedBlock, event.clientY)

    // Skip "inside" when the dragged item is already nested under the target
    // (dropping would be a no-op). The user can outdent by dragging to "after"
    // a shallower-depth item elsewhere in the list instead.
    if (!isSelfTarget && position === "inside" && resolvedBlock.tagName === "LI") {
      const dragRootEl = this.#editor.getElementByKey(this.#draggedNodeKey)
      if (dragRootEl) {
        const nextEl = resolvedBlock.nextElementSibling
        if (nextEl && nextEl.classList.contains(NESTED_LISTITEM_CLASS) && nextEl.contains(dragRootEl)) {
          return null
        }
      }
    }

    // Skip "before" when the dragged item is already directly above the target
    // (dropping would be a no-op).
    if (!isSelfTarget && position === "before" && resolvedBlock.tagName === "LI") {
      let isDraggedPrevSibling = false
      this.#editor.getEditorState().read(() => {
        const targetNode = $getNodeByKey(nodeKey)
        const draggedNode = $getNodeByKey(this.#draggedNodeKey)
        if (targetNode && draggedNode) {
          const prev = targetNode.getPreviousSibling()
          if (prev) {
            if (prev.getKey() === this.#draggedNodeKey) {
              isDraggedPrevSibling = true
            } else if ($isStructuralWrapper(prev)) {
              // Structural wrapper — check if dragged is before it
              const beforeWrapper = prev.getPreviousSibling()
              if (beforeWrapper && beforeWrapper.getKey() === this.#draggedNodeKey) {
                isDraggedPrevSibling = true
              }
            }
          }
        }
      })
      if (isDraggedPrevSibling) return null
    }

    // Note: we intentionally allow "after" even when the dragged item is
    // the immediate next sibling. The snap system offers depth selection —
    // same depth is a no-op, but dragging left enables multi-level outdent.

    const targetDepth = getElementNestingDepth(resolvedBlock, root)
    const closestList = resolvedBlock.closest("ul, ol")
    // Effective marker style: prefer the wrapped block's data-wrapper-marker
    // (set by syncWrapperMarkers, which walks previous siblings to inherit
    // the effective marker), then look at the previous sibling's marker,
    // then fall back to the closest list's tag. This makes the indicator
    // visually match the bullet/number style of the item above the drop
    // position — important in mixed-marker lists where the closest list's
    // tag (UL/OL) doesn't reflect the rendered marker.
    const listType = this.#effectiveListType(resolvedBlock, closestList, position)
    const listPadding = closestList
      ? parseFloat(getComputedStyle(closestList).paddingInlineStart) || DEFAULT_ROOT_PADDING
      : 28
    const blockLeft = resolvedBlock.getBoundingClientRect().left

    // Check if the dragged content is a list item, and whether it wraps
    // a non-text block (heading, code, HR, etc.) that can exit to root level.
    let draggedIsListContent = false
    let draggedIsWrappedBlock = false
    this.#editor.getEditorState().read(() => {
      const node = $getNodeByKey(this.#draggedNodeKey)
      draggedIsListContent = $isListItemNode(node) || $isListNode(node)
      if ($isListItemNode(node)) {
        const kids = node.getChildren().filter(c => !$isListNode(c))
        draggedIsWrappedBlock = kids.length === 1 && $isElementNode(kids[0]) &&
          !$isParagraphNode(kids[0]) && !$isListNode(kids[0])
      }
    })

    const isInList = resolvedBlock.tagName === "LI"

    // Wrapped blocks can exit to root level with "before" on the FIRST
    // item in a sublist. Only offer outdent at list boundaries.
    if (isInList && draggedIsWrappedBlock && position === "before") {
      let isFirstInSublist = false
      if (resolvedBlock.tagName === "LI") {
        let prevSib = resolvedBlock.previousElementSibling
        while (prevSib && prevSib.classList.contains(NESTED_LISTITEM_CLASS)) {
          prevSib = prevSib.previousElementSibling
        }
        isFirstInSublist = !prevSib
      }

      if (isFirstInSublist) {
        const snapPoints = this.#getDropSnapPoints(resolvedBlock, position, root)
        const validSnaps = snapPoints.filter(p => p.depth >= 0 && p.depth <= targetDepth)
        if (validSnaps.length > 1) {
          const snap = findNearestSnapPoint(validSnaps, event.clientX)
          if (snap.depth < targetDepth) {
            const snapContentLeft = snap.pixelLeft + listPadding
            const snapBulletLeft = snap.depth === 0 ? snapContentLeft : (listType === "ol" ? snapContentLeft : snapContentLeft - 12)
            return { element: resolvedBlock, nodeKey, position, depth: snap.depth, bulletLeft: snapBulletLeft, contentLeft: snapContentLeft, listType }
          }
        }
      }
    }

    if (position === "inside") {
      // "Inside" = become a child of the target at target + 1. Always valid —
      // the target itself is the depth gate (you need an item at each level).
      const insideDepth = targetDepth + 1
      const insideContentLeft = blockLeft + listPadding
      const insideBulletLeft = listType === "ol" ? insideContentLeft : insideContentLeft - 12
      return { element: resolvedBlock, nodeKey, position, depth: insideDepth, bulletLeft: insideBulletLeft, contentLeft: insideContentLeft, listType }
    }

    // For "after" on list items, use cursor X to select depth via snap
    // points. Outdenting (shallower depth) is only offered when the target
    // is the LAST item in its sublist — outdenting from the middle of a
    // list would be jarring (splits the list unexpectedly).
    if (isInList && position === "after") {
      // Check if the target is the last real item in its list (allowing outdent)
      let isLastInSublist = false
      if (resolvedBlock.tagName === "LI") {
        let nextSib = resolvedBlock.nextElementSibling
        // Skip structural wrappers
        while (nextSib && nextSib.classList.contains(NESTED_LISTITEM_CLASS)) {
          nextSib = nextSib.nextElementSibling
        }
        isLastInSublist = !nextSib
      }

      const snapPoints = this.#getDropSnapPoints(resolvedBlock, position, root)

      // Non-list items and wrapped blocks can exit to root level (depth 0).
      // Regular list items stay at depth >= 1 (they need a parent list).
      const minSnapDepth = ((!draggedIsListContent || draggedIsWrappedBlock) && isLastInSublist) ? 0 : 1
      // Offer shallower depths at the end of a sublist, or for self-targets
      // (self-outdent can promote from any position without affecting siblings)
      const minDepth = (isLastInSublist || isSelfTarget) ? minSnapDepth : targetDepth
      const validSnaps = snapPoints.filter(p => p.depth >= minDepth && p.depth <= targetDepth)
      if (validSnaps.length >= 1) {
        const snap = validSnaps.length > 1
          ? findNearestSnapPoint(validSnaps, event.clientX)
          : validSnaps[0]
        const snapContentLeft = snap.pixelLeft + listPadding
        const snapBulletLeft = snap.depth === 0 ? snapContentLeft : (listType === "ol" ? snapContentLeft : snapContentLeft - 12)
        // Self-target is only valid when depth actually changes (outdent)
        if (isSelfTarget && snap.depth >= targetDepth) return null
        // "After target X" where the dragged item is X's immediate next
        // sibling AND we're not outdenting (snap.depth === targetDepth)
        // resolves to a drop on the dragged's own row that wouldn't
        // change anything — hide the indicator. Multi-level outdent
        // gestures (snap.depth < targetDepth) still pass through so
        // dragging left for outdent still gets feedback.
        if (!isSelfTarget && snap.depth === targetDepth && this.#draggedIsImmediateNextSibling(nodeKey)) {
          return null
        }
        return { element: resolvedBlock, nodeKey, position, depth: snap.depth, bulletLeft: snapBulletLeft, contentLeft: snapContentLeft, listType }
      }
    }

    // Self-target at same depth is a no-op
    if (isSelfTarget) return null

    // Before/after: place at the target's depth as a sibling.
    // The native UL bullet center is ~10px left of the LI content edge.
    // Subtract the indicator circle radius (3px) so the circle center aligns.
    // At depth 0 (root level) there's no bullet, so no offset needed.
    // For OL, leave bulletLeft at blockLeft and let the CSS absolutely
    // position the "#." in a 2em right-aligned box mirroring the OL
    // counter's own positioning. Otherwise the indicator floats to the
    // left of the rendered "1." / "2." / "3." which is right-aligned in
    // the same 2em box.
    const bulletLeft = targetDepth === 0 ? blockLeft : (listType === "ol" ? blockLeft : blockLeft - 12)
    return { element: blockElement, nodeKey, position, depth: targetDepth, bulletLeft, contentLeft: blockLeft, listType }
  }

  // List items: before / inside / after zones. When the item already has
  // nested children (structural wrapper after it), the "inside" zone is
  // expanded to make nesting easier — it's the most common intent.
  // Other blocks: top/bottom 50/50
  #computeVerticalPosition(element, clientY) {
    const rect = element.getBoundingClientRect()
    const ratio = (clientY - rect.top) / rect.height

    if (element.tagName === "LI") {
      // Check if this item has children (structural wrapper as next sibling)
      const next = element.nextElementSibling
      const hasChildren = next && next.classList.contains(NESTED_LISTITEM_CLASS)

      if (hasChildren) {
        // Expanded inside zone: 20/60/20 — makes it easy to nest inside
        // items that already have children
        if (ratio < 0.2) return "before"
        if (ratio > 0.8) return "after"
        return "inside"
      }

      // Items without children: 30/40/30 before/inside/after
      if (ratio < 0.3) return "before"
      if (ratio > 0.7) return "after"
      return "inside"
    }

    return ratio < 0.5 ? "before" : "after"
  }

  // Build an array of { depth, pixelLeft } snap points from real DOM measurements.
  // Each point represents a valid nesting level the dragged block can land at.
  // Callers filter the returned array by their own allowed minimum depth —
  // the "before" case permits depth 0 for all draggables, and the "after"
  // case permits depth 0 only for wrapped blocks and non-list content.
  // Defaulting to 0 here means the returned array always contains every
  // candidate; callers re-filter so nothing unintended lands at root.
  #getDropSnapPoints(blockElement, position, root, minDepth = 0) {
    const points = []
    const seen = new Set()

    function addPoint(depth, pixelLeft) {
      if (depth < minDepth) return
      if (seen.has(depth)) return
      seen.add(depth)
      points.push({ depth, pixelLeft })
    }

    // Depth 0: root-level snap. Cached per drag — the root's position doesn't
    // move while the user holds the pointer, so we read it once at the first
    // #getDropSnapPoints call and reuse on every subsequent RAF.
    if (this.#rootSnapLeft === null) {
      const rootRect = root.getBoundingClientRect()
      const rootPadding = parseFloat(getComputedStyle(root).paddingInlineStart) || 0
      this.#rootSnapLeft = rootRect.left + rootPadding
    }
    addPoint(0, this.#rootSnapLeft)

    // Collect actual UL/OL ancestors to get real indent positions per depth
    const listAncestors = []
    let current = blockElement
    while (current && current !== root) {
      if (current.tagName === "UL" || current.tagName === "OL") {
        listAncestors.unshift(current) // outermost first
      }
      current = current.parentElement
    }

    for (let i = 0; i < listAncestors.length; i++) {
      // Use the list container's left edge — this is where the bullet/marker
      // sits, not the text content start (which is further right).
      // Cache per list element across frames; positions are stable during a drag.
      const listEl = listAncestors[i]
      let left = this.#listLeftCache.get(listEl)
      if (left === undefined) {
        left = listEl.getBoundingClientRect().left
        this.#listLeftCache.set(listEl, left)
      }
      addPoint(i + 1, left)
    }

    return points.sort((a, b) => a.depth - b.depth)
  }

  // -- Drop indicator positioning ---------------------------------------------

  #showDropIndicator(target) {
    const editorRect = this.#editorElement.getBoundingClientRect()
    const blockRect = target.element.getBoundingClientRect()
    const root = this.#editor.getRootElement()
    if (!root) return
    const rootRect = root.getBoundingClientRect()

    // The indicator line is 2px tall; offset by 1px so its visual center
    // aligns with the computed midpoint rather than its top edge.
    const lineOffset = 2

    let top
    const isSelfOutdent = target.nodeKey === this.#draggedNodeKey
    if (target.position === "before") {
      // Center the indicator between the previous sibling and this block
      // so that "after A" and "before B" converge to the same position.
      const prev = previousContentSibling(target.element, root)
      if (prev) {
        top = (prev.getBoundingClientRect().bottom + blockRect.top) / 2 - editorRect.top - lineOffset
      } else if (target.element.tagName === "LI") {
        // First item in a list: offset above the item so the indicator
        // doesn't crowd it.
        top = blockRect.top - editorRect.top - 8
      } else {
        top = blockRect.top - editorRect.top - 1
      }
    } else if (isSelfOutdent) {
      // Self-outdent: show where the item will actually land — after the
      // structural wrapper that contains it, not at the item's own position.
      const parentWrapper = target.element.closest("li.lexxy-nested-listitem")
      if (parentWrapper) {
        top = parentWrapper.getBoundingClientRect().bottom - editorRect.top - 1
      } else {
        top = blockRect.bottom - editorRect.top - 1
      }
    } else {
      // "After" and "inside": center between this block and the next sibling
      const next = nextContentSibling(target.element, root)
      if (next && target.position === "after") {
        top = (blockRect.bottom + next.getBoundingClientRect().top) / 2 - editorRect.top - lineOffset
      } else if (target.position === "after" && target.element.tagName === "LI") {
        // Last item in a list: offset below the item so the indicator
        // doesn't crowd it.
        top = blockRect.bottom - editorRect.top + 6
      } else {
        top = blockRect.bottom - editorRect.top - 1
      }
    }

    const left = target.bulletLeft - editorRect.left
    const gap = target.contentLeft - target.bulletLeft - 3
    const rootPaddingRight = parseFloat(getComputedStyle(root).paddingInlineEnd) || 0
    const right = editorRect.right - rootRect.right + rootPaddingRight

    this.#dropIndicator.show({ top, left, right, gap, depth: target.depth, listType: target.listType })
  }

  #hideDropIndicator() {
    this.#dropIndicator.hide()
  }

  // -- Drop execution ---------------------------------------------------------

  #performDrop() {
    const target = this.#dropTarget
    const draggedKey = this.#draggedNodeKey
    if (!target || !draggedKey) return

    // Multi-block drop: delegate to the extension's group-drop helper
    // (which has access to all the wrapper/block-parent helpers needed
    // to classify the selection and detach/re-attach subtrees as a unit).
    // The helper handles its own pushSelectionHistory + editor.update.
    if (this.#blockSelectionExtension.blockSelectionSize() > 1) {
      const handled = this.#blockSelectionExtension.performMultiDrop({
        targetKey: target.nodeKey,
        position: target.position
      })
      if (handled) return
      // Fell through (e.g., target was inside the selection) — try
      // the single-block path as a last resort.
    }

    // Snapshot the block-selection state BEFORE the drop's editor.update
    // so Lexical's UNDO can restore it. Without this, Lexical reverts the
    // tree on undo but the JS-side selection (selectedBlockKeys, anchor,
    // focus) stays at its post-drop value — and any keys that changed
    // during the move resolve to nothing after the revert, leaving the
    // dragged item unhighlighted at its restored location.
    this.#blockSelectionExtension.pushSelectionHistory()

    this.#editor.update(() => {
      try {
      const draggedNode = $getNodeByKey(draggedKey)
      if (!draggedNode) return

      const targetNode = $getNodeByKey(target.nodeKey)
      if (!targetNode) return

      // Self-target: outdent-in-place (promote to shallower depth without
      // re-parenting the parent's existing children)
      if (draggedNode.is(targetNode)) {
        if (target.position !== "after" || !$isListItemNode(draggedNode)) return
        const currentDepth = this.#getNodeDepth(draggedNode)
        if (target.depth >= currentDepth) return
        this.#performSelfOutdent(draggedNode, target.depth)
        return
      }

      const draggedIsListContent = $isListItemNode(draggedNode) || $isListNode(draggedNode)

      // 1. Detach the dragged node and its associated structural wrapper
      //    (children). The wrapper is the next sibling if it's a structural
      //    wrapper (only contains ListNodes).
      let associatedWrapper = null
      if ($isListItemNode(draggedNode)) {
        const next = draggedNode.getNextSibling()
        if ($isStructuralWrapper(next)) {
          associatedWrapper = next
          associatedWrapper.remove()
        }
      }

      // For outdent operations (moving to a shallower depth within a list),
      // capture trailing siblings from the original list. Standard outliner
      // behavior: items after the outdented item become its children.
      const trailingSiblings = []
      const draggedDepth = $isListItemNode(draggedNode) ? this.#getNodeDepth(draggedNode) : 0
      if (target.depth > 0 && target.depth < draggedDepth && $isListItemNode(draggedNode)) {
        let sib = draggedNode.getNextSibling()
        while (sib) {
          const nextSib = sib.getNextSibling()
          trailingSiblings.push(sib)
          sib.remove()
          sib = nextSib
        }
        // If removing trailing siblings + dragged node will empty the parent
        // list, proactively remove the structural wrapper chain NOW (before
        // draggedNode.remove triggers Lexical normalization artifacts).
        const parentList = draggedNode.getParent()
        if ($isListNode(parentList) && parentList.getChildrenSize() <= 1) {
          const parentWrapper = parentList.getParent()
          if ($isListItemNode(parentWrapper) && $isStructuralWrapper(parentWrapper)) {
            // Capture grandparent before removing
            const grandparentList = parentWrapper.getParent()
            draggedNode.remove()
            parentWrapper.remove()
            // Walk up and clean any newly-empty ancestor wrappers
            if ($isListNode(grandparentList)) {
              this.#cleanupEmptyStructuralWrappers(grandparentList)
            }
          }
        }
      }

      // May be null if the node was already removed during proactive cleanup
      const oldParentList = draggedNode.getParent()
      // Capture the root-level source list key and its existing LI keys NOW,
      // before unwrap/cleanup operations may detach intermediate nodes.
      // The snapshot lets the post-transform cleanup distinguish normalization
      // artifacts from user-created empty list items.
      const rootSourceList = this.#findRootList(oldParentList)
      this.#pendingSourceListKey = rootSourceList?.getKey() ?? null
      // Snapshot content LI keys (exclude structural wrappers — those may
      // get transformed into empty LIs by normalization and need cleanup).
      const existingLIKeys = rootSourceList
        ? new Set(rootSourceList.getChildren()
          .filter(c => $isListItemNode(c) && !$isStructuralWrapper(c))
          .map(c => c.getKey()))
        : new Set()
      this.#pendingExistingLIKeys = existingLIKeys

      // 2. Prepare the node for its destination context
      let nodeToInsert
      const droppingIntoList = target.depth > 0 || target.position === "inside"

      if (droppingIntoList) {
        // Target is in a list (or we're nesting inside a root block)
        if (draggedIsListContent) {
          if (draggedNode.getParent()) draggedNode.remove()
          nodeToInsert = draggedNode
        } else {
          // Non-list block entering a list → wrap in ListItemNode
          draggedNode.remove()
          const listItem = $createListItemNode()
          listItem.append(draggedNode)
          nodeToInsert = listItem
        }
      } else {
        // Dropping at root level → unwrap from list if needed
        nodeToInsert = this.#unwrapForRoot(draggedNode)
      }

      // 3. Clean up empty structural wrappers left behind by the move.
      //    Only removes structural wrappers (li nodes whose only children
      //    are lists) when those inner lists are empty, plus orphaned
      //    wrappers with zero children. Does NOT touch empty content list
      //    items that have paragraph children — those may be intentional.
      //    Capture the outermost source list key BEFORE cleanup (cleanup
      //    may remove intermediate nodes, breaking the parent chain).
      this.#cleanupEmptyStructuralWrappers(oldParentList)
      if (oldParentList) {
        const outerWrapper = oldParentList.getParent()
        if ($isListItemNode(outerWrapper)) {
          const outerList = outerWrapper.getParent()
          if ($isListNode(outerList)) this.#cleanupEmptyStructuralWrappers(outerList)
        }
      }

      // 4. Insert at the correct position and depth
      if (target.position === "inside") {
        this.#nestInsideTarget(nodeToInsert, targetNode)
        if (associatedWrapper) {
          nodeToInsert.insertAfter(associatedWrapper)
        }
      } else if (target.position === "before") {
        // "Before" always uses the target's natural depth (no snap outdent)
        if (droppingIntoList) {
          targetNode.insertBefore(nodeToInsert)
        } else {
          // Root level: insert before the root-level list or block
          const rootAncestor = this.#findRootList(targetNode) || targetNode
          rootAncestor.insertBefore(nodeToInsert)
        }
        if (associatedWrapper) {
          nodeToInsert.insertAfter(associatedWrapper)
        }
      } else {
        // "After" — may involve depth change via snap points.
        const targetDepth = this.#getNodeDepth(targetNode)

        if (target.depth < targetDepth && droppingIntoList) {
          // Outdenting: walk up to the ancestor at the desired depth.
          // Insert between the text item and its structural wrapper so
          // the wrapper's children naturally become the inserted item's
          // children (standard outliner re-parenting behavior).
          const ancestor = this.#findInsertionAncestor(targetNode, target.depth)
          const textItem = $isStructuralWrapper(ancestor)
            ? ancestor.getPreviousSibling() : ancestor

          if (textItem && $isListItemNode(textItem) && !$isStructuralWrapper(textItem)) {
            // The structural wrapper after textItem will become nodeToInsert's children
            const existingWrapper = textItem.getNextSibling()
            const reparenting = existingWrapper && $isStructuralWrapper(existingWrapper)

            textItem.insertAfter(nodeToInsert)

            if (reparenting && associatedWrapper) {
              // Merge: nodeToInsert has its own children AND is adopting
              // the former parent's children. Put associatedWrapper first,
              // then append the re-parented children into the same list.
              nodeToInsert.insertAfter(associatedWrapper)
              const assocList = associatedWrapper.getChildren().find(c => $isListNode(c))
              const existingList = existingWrapper.getChildren().find(c => $isListNode(c))
              if (assocList && existingList) {
                for (const child of [ ...existingList.getChildren() ]) {
                  assocList.append(child)
                }
                // Remove the emptied list before removing the wrapper to
                // prevent Lexical's list transforms from seeing an empty
                // list and looping during normalization.
                existingList.remove()
              }
              existingWrapper.remove()
              associatedWrapper = null // already handled
            } else if (associatedWrapper) {
              nodeToInsert.insertAfter(associatedWrapper)
              associatedWrapper = null
            }
            // If no associatedWrapper, existingWrapper stays in place —
            // it's now after nodeToInsert, making its children belong to nodeToInsert
          } else {
            // Fallback: insert after ancestor
            this.#insertAfterWithWrappers(ancestor, nodeToInsert)
          }
        } else if (droppingIntoList) {
          // Same depth: insert after the target. If the target has children
          // (structural wrapper), insert between the target and its wrapper
          // so the children transfer to the inserted item.
          const nextSib = targetNode.getNextSibling()
          if (nextSib && $isStructuralWrapper(nextSib)) {
            targetNode.insertAfter(nodeToInsert)
            // existingWrapper stays in place → now after nodeToInsert → children transfer
            if (associatedWrapper) {
              nodeToInsert.insertAfter(associatedWrapper)
              const assocList = associatedWrapper.getChildren().find(c => $isListNode(c))
              const existingList = nextSib.getChildren().find(c => $isListNode(c))
              if (assocList && existingList) {
                for (const child of [ ...existingList.getChildren() ]) {
                  assocList.append(child)
                }
                existingList.remove()
              }
              nextSib.remove()
              associatedWrapper = null
            }
          } else {
            // No children to re-parent — simple insert after target
            this.#insertAfterWithWrappers(targetNode, nodeToInsert)
          }
        } else {
          // Root level: insert after the root-level list or block
          const rootAncestor = this.#findRootList(targetNode) || targetNode
          rootAncestor.insertAfter(nodeToInsert)
        }

        if (associatedWrapper) {
          if (droppingIntoList) {
            nodeToInsert.insertAfter(associatedWrapper)
          } else {
            // At root level, convert the structural wrapper's inner list
            // to a standalone list so children remain accessible.
            const innerList = associatedWrapper.getChildren().find(c => $isListNode(c))
            if (innerList) {
              nodeToInsert.insertAfter(innerList)
            }
            associatedWrapper.remove()
          }
        }
      }

      // 5. Re-parent trailing siblings under the outdented item (standard
      //    outliner behavior: items that were after the outdented item in its
      //    original list become its children at the same relative depth).
      if (trailingSiblings.length > 0 && $isListItemNode(nodeToInsert)) {
        let nestedList = null
        // If the item already has a structural wrapper (its own children),
        // append trailing siblings to the same nested list.
        if (associatedWrapper && associatedWrapper.getParent()) {
          nestedList = associatedWrapper.getChildren().find(c => $isListNode(c))
        }
        if (!nestedList) {
          // Create a new structural wrapper + nested list
          const parentList = nodeToInsert.getParent()
          const listType = $isListNode(parentList) ? parentList.getListType() : "bullet"
          nestedList = $createListNode(listType)
          const wrapper = $createListItemNode()
          wrapper.append(nestedList)
          if (associatedWrapper && associatedWrapper.getParent()) {
            associatedWrapper.insertAfter(wrapper)
          } else {
            nodeToInsert.insertAfter(wrapper)
          }
        }
        for (const s of trailingSiblings) {
          nestedList.append(s)
        }
      }

      // Also clean up the destination list (the empty wrapper may have
      // ended up in a different list than oldParentList)
      const destList = nodeToInsert.getParent()
      if ($isListNode(destList) && destList !== oldParentList) {
        this.#cleanupEmptyStructuralWrappers(destList)
      }

      // 6. Adopt the target list's type (bullet ↔ number) when crossing
      //    between different list types. Only changes the moved item and its
      //    immediate structural wrapper — children keep their own types.
      if (droppingIntoList && $isListItemNode(nodeToInsert)) {
        const parentList = nodeToInsert.getParent()
        if ($isListNode(parentList)) {
          const listType = parentList.getListType()
          // Clear any explicit type override so the item inherits from its
          // new parent list (e.g., "bullet" → "number")
          if (nodeToInsert.setListItemType) {
            nodeToInsert.setListItemType(undefined)
          }
          // Update the associated wrapper's inner list to match
          if (associatedWrapper && associatedWrapper.getParent()) {
            for (const child of associatedWrapper.getChildren()) {
              if ($isListNode(child)) {
                child.setListType(listType)
              }
            }
          }
        }
      }

      // Force bullet depth recalculation on the moved node and any
      // ListItemNode children (they may have changed nesting depth).
      this.#markListItemsDirty(nodeToInsert)
      if (associatedWrapper && associatedWrapper.getParent()) {
        this.#markListItemsDirty(associatedWrapper)
      }

      // Select the moved node so undo/redo has a stable scroll anchor
      if ($isElementNode(nodeToInsert)) {
        nodeToInsert.selectStart()
      }
      // Inherit parent highlight color after drop
      if ($isListItemNode(nodeToInsert)) {
        this.#blockSelectionExtension.inheritParentHighlight(nodeToInsert.getKey())
      }
      } catch (e) {
        console.error("[BlockDragAndDrop] Drop update error:", e)
      }
    }, { tag: "history-push" })

    // After Lexical's transforms run, clean up any empty LIs that
    // normalization may have inserted (e.g., replacing a removed
    // structural wrapper with an empty paragraph LI). Use setTimeout
    // to ensure transforms from the drop update have fully committed.
    if (this.#pendingSourceListKey) {
      const sourceKey = this.#pendingSourceListKey
      const priorKeys = this.#pendingExistingLIKeys
      setTimeout(() => {
        this.#editor.update(() => {
          const list = $getNodeByKey(sourceKey)
          if ($isListNode(list)) {
            for (const child of [ ...list.getChildren() ]) {
              if (!$isListItemNode(child)) continue
              // Only remove empty LIs that are NEW (not in the pre-drop snapshot).
              // This preserves user-created empty list items.
              if (priorKeys.has(child.getKey())) continue
              if (child.getTextContentSize() === 0 && child.getChildrenSize() <= 1) {
                const kids = child.getChildren()
                if (kids.every(k => $isParagraphNode(k))) {
                  child.remove()
                }
              }
            }
          }
        })
        this.#pendingSourceListKey = null
        this.#pendingExistingLIKeys = new Set()
      }, 0)
    }
  }

  // Outdent-in-place: promote the dragged node to a shallower depth
  // without re-parenting the parent's existing children. Inserts AFTER
  // the structural wrapper at the target depth (rather than between the
  // text item and its wrapper, which would adopt children).
  #performSelfOutdent(draggedNode, desiredDepth) {
    const ancestor = this.#findInsertionAncestor(draggedNode, desiredDepth)

    // Save references before any mutations
    const textItem = $isStructuralWrapper(ancestor)
      ? ancestor.getPreviousSibling() : ancestor
    const structuralWrapper = $isStructuralWrapper(ancestor)
      ? ancestor
      : (textItem?.getNextSibling() && $isStructuralWrapper(textItem.getNextSibling())
        ? textItem.getNextSibling() : null)

    // Detach the dragged node's own children (structural wrapper after it)
    let associatedWrapper = null
    const next = draggedNode.getNextSibling()
    if (next && $isStructuralWrapper(next)) {
      associatedWrapper = next
      associatedWrapper.remove()
    }

    // Track the parent wrapper by key BEFORE removal — Lexical's inline
    // transforms may normalize it (replacing its ListNode child with a
    // ParagraphNode), at which point #isStructuralWrapper no longer
    // recognizes it. We need to clean it up regardless.
    // IMPORTANT: don't clean up the wrapper if it's the insertion target
    // (structuralWrapper) — that would destroy our insertion point.
    const oldParentList = draggedNode.getParent()
    const oldParentWrapper = oldParentList?.getParent()
    const isInsertionTarget = structuralWrapper && oldParentWrapper &&
      oldParentWrapper.getKey() === structuralWrapper.getKey()
    const oldWrapperKey = (!isInsertionTarget && oldParentWrapper &&
      $isListItemNode(oldParentWrapper) &&
      $isStructuralWrapper(oldParentWrapper)) ? oldParentWrapper.getKey() : null

    draggedNode.remove()

    // Clean up the parent wrapper chain. Check by key since Lexical
    // normalization may have converted the wrapper to a regular item.
    if (oldWrapperKey) {
      const wrapper = $getNodeByKey(oldWrapperKey)
      if (wrapper && wrapper.getParent()) {
        const grandparentList = wrapper.getParent()
        if ($isStructuralWrapper(wrapper)) {
          const hasNonEmptyList = wrapper.getChildren().some(c =>
            $isListNode(c) && c.getChildrenSize() > 0)
          if (!hasNonEmptyList) {
            wrapper.remove()
            if ($isListNode(grandparentList)) this.#cleanupEmptyStructuralWrappers(grandparentList)
          }
        } else if (wrapper.getTextContentSize() === 0) {
          wrapper.remove()
          if ($isListNode(grandparentList)) this.#cleanupEmptyStructuralWrappers(grandparentList)
        }
      }
    } else if (!isInsertionTarget && oldParentList && $isListNode(oldParentList)) {
      this.#cleanupEmptyStructuralWrappers(oldParentList)
    }

    // Insert after the structural wrapper (preserves parent's children) or
    // after the text item if the wrapper was cleaned up (dragged was only child)
    const insertAfter = (structuralWrapper?.getParent()) ? structuralWrapper : textItem
    if (!insertAfter?.getParent()) return

    insertAfter.insertAfter(draggedNode)

    // Re-attach the dragged node's own children
    if (associatedWrapper) {
      draggedNode.insertAfter(associatedWrapper)
    }

    // Clean up any artifacts in the destination list
    const destList = draggedNode.getParent()
    if ($isListNode(destList)) this.#cleanupEmptyStructuralWrappers(destList)

    // Adopt destination list type and mark dirty for bullet recalc
    const parentList = draggedNode.getParent()
    if ($isListNode(parentList) && $isListItemNode(draggedNode)) {
      draggedNode.markDirty()
    }

    this.#blockSelectionExtension.enterBlockSelectMode(draggedNode.getKey())
  }

  // Insert nodeToInsert after the given target, skipping past any
  // structural wrappers (children containers) that follow it.
  #insertAfterWithWrappers(target, nodeToInsert) {
    let afterTarget = target
    let next = afterTarget.getNextSibling()
    while ($isStructuralWrapper(next)) {
      afterTarget = next
      next = afterTarget.getNextSibling()
    }
    afterTarget.insertAfter(nodeToInsert)
  }

  // Clean up empty structural wrappers in a list and its ancestors.
  // Only removes structural wrappers (li nodes that only contain lists)
  // when those inner lists are empty. Never removes content list items.
  #cleanupEmptyStructuralWrappers(list) {
    if (!$isListNode(list)) return
    for (const child of [ ...list.getChildren() ]) {
      if (!$isListItemNode(child)) continue
      if ($isStructuralWrapper(child)) {
        // Structural wrapper — remove if all inner lists are empty
        if (child.getChildren().every(inner => $isListNode(inner) && inner.getChildrenSize() === 0)) {
          child.remove()
        }
      } else if (child.getTextContentSize() === 0 && child.getChildrenSize() <= 1) {
        // Lexical may normalize an emptied structural wrapper into a
        // regular list item with an empty paragraph. Detect these by
        // checking for zero text content + at most one (empty) paragraph.
        const kids = child.getChildren()
        if (kids.every(k => $isParagraphNode(k))) {
          const el = this.#editor.getElementByKey(child.getKey())
          // Remove if it has the structural wrapper CSS class (pre-reconciliation)
          // OR if the node has no previous sibling and was likely just inserted
          // by normalization at the position of a removed wrapper.
          if (el?.classList.contains(NESTED_LISTITEM_CLASS) || !el) {
            child.remove()
          }
        }
      }
    }
    if (list.getChildrenSize() === 0) {
      const parentWrapper = list.getParent()
      if ($isStructuralWrapper(parentWrapper)) {
        const grandparentList = parentWrapper.getParent()
        parentWrapper.remove()
        if ($isListNode(grandparentList)) this.#cleanupEmptyStructuralWrappers(grandparentList)
      }
    }
  }

  #markListItemsDirty(node, seen = new Set()) {
    const key = node.getKey()
    if (seen.has(key)) return
    seen.add(key)
    if ($isListItemNode(node)) node.markDirty()
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        this.#markListItemsDirty(child, seen)
      }
    }
  }

  // Find the root-level ListNode that contains a given node
  #findRootList(node) {
    let current = node
    while (current) {
      const parent = current.getParent()
      if (!parent) return null
      if ($isListNode(current) && parent === $getRoot()) return current
      current = parent
    }
    return null
  }

  // Walk up from targetNode to find the ancestor at the correct nesting depth.
  // This ensures before/after drops match the indicated position, even when
  // the target is inside a nested sub-list (structural wrapper chain).
  #findInsertionAncestor(targetNode, desiredDepth) {
    const root = $getRoot()
    let current = targetNode
    let currentDepth = this.#getNodeDepth(current)

    while (currentDepth > desiredDepth && current.getParent() !== root) {
      const parent = current.getParent()
      if (!parent) break

      if ($isListNode(parent)) {
        // Go up past the list to its wrapper
        const wrapper = parent.getParent()
        if (wrapper && $isListItemNode(wrapper)) {
          current = wrapper
          currentDepth = this.#getNodeDepth(current)
          continue
        }
        current = parent
        currentDepth = this.#getNodeDepth(current)
      } else {
        current = parent
        currentDepth = this.#getNodeDepth(current)
      }
    }

    return current
  }

  // Get the nesting depth of a Lexical node (number of ListNode ancestors).
  // Delegates to Lexical's \$getListDepth after finding the containing list;
  // returns 0 for nodes at root level (no list ancestor).
  #getNodeDepth(node) {
    const list = $getNearestNodeOfType(node, ListNode)
    return list ? $getListDepth(list) : 0
  }

  // Nest a node as the first child of the target's sub-list.
  #nestInsideTarget(nodeToInsert, targetNode) {
    if ($isListItemNode(targetNode)) {
      // Find existing structural wrapper with nested list after the target
      let nestedList = null
      const nextSibling = targetNode.getNextSibling()
      if ($isStructuralWrapper(nextSibling)) {
        nestedList = nextSibling.getChildren()[0]
      }

      if (!nestedList) {
        // Create a new structural wrapper + nested list
        const parentList = targetNode.getParent()
        const listType = $isListNode(parentList) ? parentList.getListType() : "bullet"
        nestedList = $createListNode(listType)
        const wrapper = $createListItemNode()
        wrapper.append(nestedList)
        targetNode.insertAfter(wrapper)
      }

      // If nodeToInsert is a structural wrapper (only contains lists),
      // extract the items and insert them directly.
      if ($isStructuralWrapper(nodeToInsert)) {
        const innerList = nodeToInsert.getChildren()[0]
        const firstChild = nestedList.getFirstChild()
        for (const child of [ ...innerList.getChildren() ]) {
          if (firstChild) {
            firstChild.insertBefore(child)
          } else {
            nestedList.append(child)
          }
        }
        nodeToInsert.remove()
        return
      }

      // Insert as the first child of the nested list.
      // All block types (headings, code, tables, etc.) are treated
      // uniformly — li → block at the correct structural depth.
      const firstChild = nestedList.getFirstChild()
      if ($isListItemNode(nodeToInsert)) {
        if (firstChild) {
          firstChild.insertBefore(nodeToInsert)
        } else {
          nestedList.append(nodeToInsert)
        }
      } else if ($isListNode(nodeToInsert)) {
        const items = [ ...nodeToInsert.getChildren() ]
        for (let i = items.length - 1; i >= 0; i--) {
          if (firstChild) {
            firstChild.insertBefore(items[i])
          } else {
            nestedList.append(items[i])
          }
        }
      } else {
        // Non-list block → wrap in a ListItemNode
        const listItem = $createListItemNode()
        listItem.append(nodeToInsert)
        if (firstChild) {
          firstChild.insertBefore(listItem)
        } else {
          nestedList.append(listItem)
        }
      }
    } else {
      // Target is a root-level block — can't truly nest inside a paragraph.
      // Create a new list after the target with the node inside.
      if ($isListNode(nodeToInsert)) {
        targetNode.insertAfter(nodeToInsert)
      } else if ($isListItemNode(nodeToInsert)) {
        const newList = $createListNode("bullet")
        newList.append(nodeToInsert)
        targetNode.insertAfter(newList)
      } else {
        // Wrap in a list for nesting effect
        const listItem = $createListItemNode()
        listItem.append(nodeToInsert)
        const newList = $createListNode("bullet")
        newList.append(listItem)
        targetNode.insertAfter(newList)
      }
    }
  }

  // Unwrap a drag root for placement at root level.
  // - ListNode → extract as-is (it's a valid root child)
  // - Structural wrapper ListItemNode → dig down to find the actual content
  // - Regular ListItemNode → wrap in a new ListNode (preserves bullet)
  // - Other blocks → return as-is
  #unwrapForRoot(draggedNode) {
    if ($isListNode(draggedNode)) {
      // Already a valid root-level node
      draggedNode.remove()
      return draggedNode
    }

    if ($isListItemNode(draggedNode)) {
      if ($isStructuralWrapper(draggedNode)) {
        // Dig into the structural wrapper to find the actual content
        const children = draggedNode.getChildren()
        const innerList = children[0]
        const innerItems = innerList.getChildren()
        const contentItem = innerItems.find(child =>
          $isListItemNode(child) && !$isStructuralWrapper(child)
        )

        if (contentItem) {
          // Check if the content item wraps a non-list block (HR, heading)
          const contentChildren = contentItem.getChildren().filter(c => !$isListNode(c))
          if (contentChildren.length === 1 && $isElementNode(contentChildren[0]) &&
              !$isParagraphNode(contentChildren[0])) {
            // Wrapped block → extract standalone. Detach the block BEFORE
            // removing the parent to avoid orphaning it.
            const block = contentChildren[0]
            block.remove()
            draggedNode.remove()
            return block
          }
        }

        // Regular list item inside structural wrapper → extract the inner list.
        // Detach the inner list before removing the wrapper.
        innerList.remove()
        draggedNode.remove()
        return innerList
      }

      // Regular list item → check if it wraps a non-list block
      const children = draggedNode.getChildren()
      const contentChildren = children.filter(c => !$isListNode(c))
      if (contentChildren.length === 1 && $isElementNode(contentChildren[0]) &&
          !$isParagraphNode(contentChildren[0]) && !$isListNode(contentChildren[0])) {
        // Wrapped block (HR, heading) → extract standalone. Detach the
        // block BEFORE removing the parent li to avoid orphaning it.
        const block = contentChildren[0]
        block.remove()
        draggedNode.remove()
        return block
      }

      // Regular text list item → wrap in a new ListNode
      const sourceParent = draggedNode.getParent()
      const listType = $isListNode(sourceParent) ? sourceParent.getListType() : "bullet"
      draggedNode.remove()
      const newList = $createListNode(listType)
      newList.append(draggedNode)
      return newList
    }

    // Non-list block (paragraph, heading, etc.) → return as-is
    draggedNode.remove()
    return draggedNode
  }

  // -- Utilities --------------------------------------------------------------

  #cleanup() {
    this.#autoScroll.stop()
    this.#hideDropIndicator()
    this.#ghost.remove()

    document.removeEventListener("pointermove", this.#onDragMove)
    window.removeEventListener("pointerup", this.#onDragEnd, true)
    window.removeEventListener("pointercancel", this.#onDragEnd, true)
    window.removeEventListener("mouseup", this.#onDragEnd, true)
    document.removeEventListener("keydown", this.#onDragKeydown)

    // Remove lexxy-dragging from ALL elements that have it.
    for (const el of this.#editorElement.querySelectorAll(".lexxy-dragging")) {
      el.classList.remove("lexxy-dragging")
    }
    this.#editorElement.classList.remove("lexxy-block-dragging")

    // Hide the handle and clear hover state — after a drop the DOM has
    // changed so the handle position is stale.
    this.#currentHoveredBlock?.classList.remove("lexxy-block-hovered")
    this.#currentHoveredBlock = null
    this.#handleElement?.classList.remove("lexxy-block-handle--visible")
    this.#addButtonElement?.classList.remove("lexxy-block-add--visible")

    this.#isDragging = false
    this.#isPendingDrag = false
    this.#draggedNodeKey = null
    this.#pendingNodeKey = null
    this.#dropTarget = null
    // Reset per-drag caches — positions may have changed while dragging moved
    // the DOM around (list insertion/removal during hover).
    this.#rootSnapLeft = null
    this.#listLeftCache = new WeakMap()

    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId)
      this.#rafId = null
    }
  }
}
