import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isParagraphNode
} from "lexical"
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from "@lexical/list"

const GRIP_ICON = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <circle cx="2" cy="2" r="1.5"/>
  <circle cx="8" cy="2" r="1.5"/>
  <circle cx="2" cy="7" r="1.5"/>
  <circle cx="8" cy="7" r="1.5"/>
  <circle cx="2" cy="12" r="1.5"/>
  <circle cx="8" cy="12" r="1.5"/>
</svg>`

// Minimum pointer movement (px) before a handle pointerdown becomes a drag
const DRAG_THRESHOLD = 5

// Auto-scroll: how close to a container edge (px) before scrolling starts
const SCROLL_EDGE_SIZE = 60

// Auto-scroll: maximum pixels scrolled per animation frame
const SCROLL_MAX_SPEED = 15

export class BlockDragAndDrop {
  #editor
  #editorElement
  #blockSelectionExtension
  #handleElement = null
  #addButtonElement = null
  #dropIndicatorElement = null
  #dragGhostElement = null
  #currentHoveredBlock = null
  #isDragging = false
  #isPendingDrag = false
  #pointerStartX = 0
  #pointerStartY = 0
  #pendingNodeKey = null
  #draggedNodeKey = null
  #rafId = null
  #dropTarget = null
  #hideTimer = null
  #cleanupFns = []
  #scrollRafId = null
  #scrollableContainers = null
  #lastPointerX = 0
  #lastPointerY = 0

  constructor(editor, editorElement, blockSelectionExtension) {
    this.#editor = editor
    this.#editorElement = editorElement
    this.#blockSelectionExtension = blockSelectionExtension

    this.#createAddButton()
    this.#createHandleElement()
    this.#createDropIndicator()
    this.#registerListeners()
  }

  // Re-position handle/bullet on the currently hovered block (e.g., after
  // Tab indent changes the block's DOM position). Looks up the fresh DOM
  // element by node key since Lexical may have recreated the element.
  repositionHandle() {
    if (!this.#currentHoveredBlock) return
    const key = Object.keys(this.#currentHoveredBlock).find(k => k.startsWith("__lexicalKey_"))
    if (key) {
      const nodeKey = this.#currentHoveredBlock[key]
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
    this.#dropIndicatorElement?.remove()
    for (const fn of this.#cleanupFns) fn()
    this.#cleanupFns = []
  }

  // -- Handle element ---------------------------------------------------------

  #createAddButton() {
    this.#editorElement.querySelector(".lexxy-block-add")?.remove()

    const btn = document.createElement("div")
    btn.className = "lexxy-block-add"
    btn.setAttribute("aria-label", "Add block")
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/></svg>`

    btn.addEventListener("click", this.#onAddButtonClick)

    this.#addButtonElement = btn
    this.#editorElement.appendChild(btn)
  }

  #onAddButtonClick = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!this.#currentHoveredBlock) return

    const nodeKey = this.#getNodeKeyFromElement(this.#currentHoveredBlock)
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

    this.#handleElement = document.createElement("div")
    this.#handleElement.className = "lexxy-block-handle"
    this.#handleElement.setAttribute("aria-hidden", "true")
    this.#handleElement.innerHTML = GRIP_ICON

    this.#handleElement.addEventListener("pointerdown", this.#onHandlePointerDown)

    this.#editorElement.appendChild(this.#handleElement)
  }

  #createDropIndicator() {
    this.#editorElement.querySelector(".lexxy-drop-indicator")?.remove()

    const indicator = document.createElement("div")
    indicator.className = "lexxy-drop-indicator"
    indicator.setAttribute("aria-hidden", "true")

    // The indicator has a circle at the left end and a line extending right
    const circle = document.createElement("div")
    circle.className = "lexxy-drop-indicator__circle"
    indicator.appendChild(circle)

    const line = document.createElement("div")
    line.className = "lexxy-drop-indicator__line"
    indicator.appendChild(line)

    this.#dropIndicatorElement = indicator
    this.#editorElement.appendChild(indicator)
  }

  #positionHandle(blockElement) {
    if (!this.#handleElement || !blockElement) return
    this.#cancelHideTimer()
    blockElement.classList.add("lexxy-block-hovered")

    const editorRect = this.#editorElement.getBoundingClientRect()
    const handleHeight = this.#handleElement.offsetHeight || 24
    const handleWidth = this.#handleElement.offsetWidth || 20

    const blockRect = blockElement.getBoundingClientRect()
    let top

    if (blockElement.tagName === "LI") {
      const liLineHeight = parseFloat(getComputedStyle(blockElement).lineHeight) || 24
      // +1 aligns handles with the bullet character's visual center
      // (font ascent causes the character to sit slightly above lineHeight/2)
      const defaultBulletCenter = blockRect.top + (liLineHeight / 2) - 1
      let handleCenter = defaultBulletCenter

      const innerTable = blockElement.querySelector("table, .lexxy-content__table-wrapper")
      const innerAttachment = blockElement.querySelector("figure.attachment, .attachment-gallery, .attachment")
      const innerHeading = blockElement.querySelector("h1, h2, h3, h4, h5, h6")
      const innerHR = blockElement.querySelector(".horizontal-divider, hr")

      if (innerHR) {
        // HR: center on the actual <hr> line, not the figure wrapper with padding
        const hrLine = innerHR.tagName === "HR" ? innerHR : innerHR.querySelector("hr")
        const hrRect = (hrLine || innerHR).getBoundingClientRect()
        handleCenter = hrRect.top + (hrRect.height / 2) - 1
      } else if (innerTable) {
        const firstRow = innerTable.querySelector("tr")
        if (firstRow) {
          const rowRect = firstRow.getBoundingClientRect()
          handleCenter = rowRect.top + (rowRect.height / 2) - 1
        }
      } else if (innerAttachment) {
        handleCenter = innerAttachment.getBoundingClientRect().top + (handleHeight / 2)
      } else if (innerHeading) {
        // Headings have larger font/line-height — use their first char center
        const charRect = this.#getFirstCharRect(innerHeading)
        if (charRect && charRect.height > 0) {
          handleCenter = charRect.top + (charRect.height / 2)
        }
      } else {
        // Blockquotes, code blocks, and other wrapped content with internal
        // padding: use their first character center instead of li.lineHeight
        const innerCode = blockElement.querySelector("pre, code[data-language]")
        const innerBlockquote = !innerCode ? blockElement.querySelector("blockquote") : null
        if (innerCode) {
          // Code blocks: center in the language-selector row (top padding area)
          const codeRect = innerCode.getBoundingClientRect()
          const paddingTop = parseFloat(getComputedStyle(innerCode).paddingTop) || 0
          handleCenter = codeRect.top + (paddingTop / 2)
        } else if (innerBlockquote) {
          const charRect = this.#getFirstCharRect(innerBlockquote)
          if (charRect && charRect.height > 0) {
            handleCenter = charRect.top + (charRect.height / 2)
          }
        } else {
          // Other wrapped content
          const innerBlock = blockElement.querySelector("blockquote, pre")
          if (innerBlock) {
            const charRect = this.#getFirstCharRect(innerBlock)
            if (charRect && charRect.height > 0) {
              handleCenter = charRect.top + (charRect.height / 2)
            }
          }
        }
      }

      top = handleCenter - editorRect.top - (handleHeight / 2)

      // Sync the bullet ::before so its center aligns with the handle center.
      // Compute the bullet top relative to the <li> so that
      // bulletTop + liLineHeight/2 = handleCenter (in page coords)
      // Position the bullet ::before so its center aligns with handleCenter.
      // The bullet ::before is forced to 24px height (matching handle height),
      // so its character centers at bulletTop + 12.
      const bulletTop = handleCenter - blockRect.top - 11
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
        const rowCenter = rowRect.top + (rowRect.height / 2)
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
      const firstCharRect = this.#getFirstCharRect(blockElement)
      if (firstCharRect && firstCharRect.height > 0) {
        const lineCenter = firstCharRect.top + (firstCharRect.height / 2)
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
    const addWidth = this.#addButtonElement?.offsetWidth || 20
    const gap = 1 // gap between + and ⠿
    const left = contentLeft - editorRect.left - handleWidth - 1

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

  // Get the visual left edge of a block for handle/indicator positioning.
  // For all list items, account for the bullet ::before area so handles
  // sit to the left of the bullet marker.
  #getBlockVisualLeft(blockElement) {
    if (blockElement.tagName === "LI") {
      const beforeLeft = parseFloat(getComputedStyle(blockElement, "::before").left) || 0
      return blockElement.getBoundingClientRect().left + beforeLeft
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

    const blockElement = this.#findNearestBlockElement(element, root)
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
    this.#positionHandle(blockElement)
  }

  // Find the nearest selectable block element: list items, or top-level blocks.
  // When clientY is provided (during drag), resolves list gaps to the nearest
  // child <li> instead of returning the <ul> container.
  #findNearestBlockElement(element, root, clientY = null) {
    let current = element
    while (current && current !== root) {
      // List items are individually selectable blocks — but skip structural
      // wrappers (lexxy-nested-listitem) which are just containers for nested lists
      if (current.tagName === "LI" && root.contains(current) &&
          !current.classList.contains("lexxy-nested-listitem")) {
        return current
      }
      // Top-level children of the root
      if (current.parentElement === root) {
        // During drag: if the element is a list, resolve to the nearest <li>
        // inside it to avoid jumping to root level when the mouse is in gaps.
        if (clientY !== null && (current.tagName === "UL" || current.tagName === "OL")) {
          const nearestLi = this.#findNearestListItem(current, clientY)
          if (nearestLi) return nearestLi
        }
        return current
      }
      current = current.parentElement
    }
    return null
  }

  // Find the deepest last content item inside a structural wrapper.
  // Walks into nested sublists to find the bottom-most visible item.
  #findDeepestLastItem(wrapperElement) {
    const lists = wrapperElement.querySelectorAll("ul, ol")
    let deepest = null
    for (const list of lists) {
      const items = list.querySelectorAll(":scope > li:not(.lexxy-nested-listitem)")
      if (items.length > 0) {
        deepest = items[items.length - 1]
      }
    }
    return deepest
  }

  // Find the <li> inside a list that is closest to the given clientY
  #findNearestListItem(listElement, clientY) {
    let best = null
    let bestDist = Infinity

    for (const child of listElement.querySelectorAll("li")) {
      // Skip structural wrappers (only contain nested lists, no text)
      if (child.classList.contains("lexxy-nested-listitem")) continue

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

  // -- Drag initiation (with click vs drag threshold) -------------------------

  #onHandlePointerDown = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!this.#currentHoveredBlock) return

    const nodeKey = this.#getNodeKeyFromElement(this.#currentHoveredBlock)
    if (!nodeKey) return

    // Don't start dragging immediately — wait for movement threshold
    this.#isPendingDrag = true
    this.#pointerStartX = event.clientX
    this.#pointerStartY = event.clientY
    this.#pendingNodeKey = nodeKey

    this.#handleElement.setPointerCapture(event.pointerId)

    // Select the block with children on next frame. Doing it synchronously
    // during pointerdown can trigger DOM mutations that disrupt pointer capture.
    requestAnimationFrame(() => {
      this.#blockSelectionExtension.enterBlockSelectMode(nodeKey)
    })

    document.addEventListener("pointermove", this.#onPendingDragMove)
    document.addEventListener("pointerup", this.#onPendingDragEnd)
    document.addEventListener("pointercancel", this.#onPendingDragEnd)
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

    // Release pointer capture from the handle — it was set during pointerdown
    // for the click-vs-drag threshold, but during drag we use document listeners.
    // Keeping capture on a hidden element can cause browsers to drop pointer events.
    try { this.#handleElement?.releasePointerCapture(event.pointerId) } catch {}

    // Apply visual drag state to the original block and its structural
    // wrapper (children) so the entire subtree fades during drag
    const el = this.#editor.getElementByKey(nodeKey)
    el?.classList.add("lexxy-dragging")
    const nextSib = el?.nextElementSibling
    if (nextSib && nextSib.classList.contains("lexxy-nested-listitem")) {
      nextSib.classList.add("lexxy-dragging")
    }

    // Create a floating ghost clone that follows the cursor
    this.#createDragGhost(el, event)

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

    this.#startAutoScroll()

    // Immediately update the drop indicator for the current position
    this.#updateDropIndicator(event)
  }

  #onDragMove = (event) => {
    if (!this.#isDragging) return

    event.preventDefault()

    this.#lastPointerX = event.clientX
    this.#lastPointerY = event.clientY

    this.#positionDragGhost(event)

    if (!this.#rafId) {
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null
        this.#updateDropIndicator(event)
      })
    }
  }

  // Escape cancels the drag without dropping
  #onDragKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      this.#cleanup()
    }
  }

  #onDragEnd = () => {
    if (!this.#isDragging) return

    document.removeEventListener("pointermove", this.#onDragMove)
    window.removeEventListener("pointerup", this.#onDragEnd, true)
    window.removeEventListener("pointercancel", this.#onDragEnd, true)
    window.removeEventListener("mouseup", this.#onDragEnd, true)
    document.removeEventListener("keydown", this.#onDragKeydown)

    if (this.#dropTarget && this.#draggedNodeKey) {
      try {
        this.#performDrop()
      } catch (e) {
        console.error("[BlockDragAndDrop] Drop failed:", e)
      }
    }

    this.#cleanup()
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

    const element = document.elementFromPoint(event.clientX, event.clientY)

    // When the cursor is above or below all content (in toolbar area,
    // editor padding, or root padding), offer a root-level drop.
    const rootRect = root.getBoundingClientRect()
    const isAboveContent = event.clientY < rootRect.top
    const isBelowContent = event.clientY > rootRect.bottom
    if (isAboveContent || isBelowContent || element === root) {
      const children = [...root.children].filter(c =>
        c.tagName !== "BR" && !c.classList.contains("lexxy-block-handle") &&
        !c.classList.contains("lexxy-block-add") &&
        !c.classList.contains("lexxy-drop-indicator"))
      if (children.length > 0) {
        const firstChild = children[0]
        const lastChild = children[children.length - 1]
        const firstRect = firstChild.getBoundingClientRect()
        const lastRect = lastChild.getBoundingClientRect()
        const rootPadding = parseFloat(getComputedStyle(root).paddingInlineStart) || 28
        const contentLeft = rootRect.left + rootPadding

        if (event.clientY < firstRect.top) {
          // Cursor is above ALL content → root-level "before"
          const edgeBlock = this.#findNearestBlockElement(firstChild, root, event.clientY) || firstChild
          const edgeKey = this.#getNodeKeyFromElement(edgeBlock)
          if (edgeKey && edgeKey !== this.#draggedNodeKey) {
            return { element: edgeBlock, nodeKey: edgeKey, position: "before", depth: 0, bulletLeft: contentLeft, contentLeft }
          }
        } else if (event.clientY > lastRect.bottom) {
          // Cursor is below ALL content → root-level "after"
          const edgeBlock = this.#findNearestBlockElement(lastChild, root, event.clientY) || lastChild
          const edgeKey = this.#getNodeKeyFromElement(edgeBlock)
          if (edgeKey && edgeKey !== this.#draggedNodeKey) {
            return { element: edgeBlock, nodeKey: edgeKey, position: "after", depth: 0, bulletLeft: contentLeft, contentLeft }
          }
        }
        // Cursor is in a gap within the content — fall through to normal resolution
      }
    }

    // For normal resolution, the element must be inside the content root
    if (!element || !root.contains(element)) return null

    // Pass clientY to resolve list gaps to the nearest <li>
    const blockElement = this.#findNearestBlockElement(element, root, event.clientY)
    if (!blockElement) return null

    let resolvedBlock = blockElement
    let nodeKey = this.#getNodeKeyFromElement(resolvedBlock)
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
        if (dragWrapper?.classList.contains("lexxy-nested-listitem") && dragWrapper.contains(resolvedBlock)) return null
      }
    }

    let position = isSelfTarget ? "after" : this.#computeVerticalPosition(resolvedBlock, event.clientY)

    // Skip "inside" when the dragged item is already nested under the target
    // (dropping would be a no-op). The user can outdent by dragging to "after"
    // a shallower-depth item elsewhere in the list instead.
    if (!isSelfTarget && position === "inside" && resolvedBlock.tagName === "LI") {
      const dragRootEl = this.#editor.getElementByKey(this.#draggedNodeKey)
      if (dragRootEl) {
        const nextEl = resolvedBlock.nextElementSibling
        if (nextEl && nextEl.classList.contains("lexxy-nested-listitem") && nextEl.contains(dragRootEl)) {
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
            } else if (this.#isStructuralWrapper(prev)) {
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

    const targetDepth = this.#getElementNestingDepth(resolvedBlock, root)
    const closestList = resolvedBlock.closest("ul, ol")
    const listPadding = closestList
      ? parseFloat(getComputedStyle(closestList).paddingInlineStart) || 28
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

    // Non-list blocks dropped before/after a list item → will be placed at
    // root level adjacent to the list, not inside it. Show indicator at root.
    const isInList = resolvedBlock.tagName === "LI"
    if (isInList && !draggedIsListContent && position !== "inside") {
      const rootList = resolvedBlock.closest(`.${root.className.split(" ")[0]} > ul, .${root.className.split(" ")[0]} > ol`) || root.querySelector("ul, ol")
      const rootRect = root.getBoundingClientRect()
      const rootPadding = parseFloat(getComputedStyle(root).paddingInlineStart) || 28
      const contentLeft = rootRect.left + rootPadding
      return { element: resolvedBlock, nodeKey, position, depth: 0, bulletLeft: contentLeft, contentLeft }
    }

    // Wrapped blocks can exit to root level with "before" on the FIRST
    // item in a sublist. Only offer outdent at list boundaries.
    if (isInList && draggedIsWrappedBlock && position === "before") {
      let isFirstInSublist = false
      if (resolvedBlock.tagName === "LI") {
        let prevSib = resolvedBlock.previousElementSibling
        while (prevSib && prevSib.classList.contains("lexxy-nested-listitem")) {
          prevSib = prevSib.previousElementSibling
        }
        isFirstInSublist = !prevSib
      }

      if (isFirstInSublist) {
        const snapPoints = this.#getDropSnapPoints(resolvedBlock, position, root)
        const validSnaps = snapPoints.filter(p => p.depth >= 0 && p.depth <= targetDepth)
        if (validSnaps.length > 1) {
          const snap = this.#findNearestSnapPoint(validSnaps, event.clientX)
          if (snap.depth < targetDepth) {
            const snapContentLeft = snap.pixelLeft + listPadding
            const snapBulletLeft = snapContentLeft - (listPadding / 2) - 1
            return { element: resolvedBlock, nodeKey, position, depth: snap.depth, bulletLeft: snapBulletLeft, contentLeft: snapContentLeft }
          }
        }
      }
    }

    if (position === "inside") {
      // "Inside" = become a child of the target at target + 1. Always valid —
      // the target itself is the depth gate (you need an item at each level).
      const insideDepth = targetDepth + 1
      const insideContentLeft = blockLeft + listPadding
      const insideBulletLeft = insideContentLeft - (listPadding / 2) - 1
      return { element: resolvedBlock, nodeKey, position, depth: insideDepth, bulletLeft: insideBulletLeft, contentLeft: insideContentLeft }
    }

    // For "after" on list items, use cursor X to select depth via snap
    // points. Outdenting (shallower depth) is only offered when the target
    // is the LAST item in its sublist — outdenting from the middle of a
    // list would be jarring (splits the list unexpectedly).
    if (isInList && draggedIsListContent && position === "after") {
      // Check if the target is the last real item in its list (allowing outdent)
      let isLastInSublist = false
      if (resolvedBlock.tagName === "LI") {
        let nextSib = resolvedBlock.nextElementSibling
        // Skip structural wrappers
        while (nextSib && nextSib.classList.contains("lexxy-nested-listitem")) {
          nextSib = nextSib.nextElementSibling
        }
        isLastInSublist = !nextSib
      }

      const snapPoints = this.#getDropSnapPoints(resolvedBlock, position, root)

      // Wrapped blocks (heading, code, HR) can exit to root level (depth 0).
      // Regular list items stay at depth >= 1 (they need a parent list).
      const minSnapDepth = (draggedIsWrappedBlock && isLastInSublist) ? 0 : 1
      // Offer shallower depths at the end of a sublist, or for self-targets
      // (self-outdent can promote from any position without affecting siblings)
      const minDepth = (isLastInSublist || isSelfTarget) ? minSnapDepth : targetDepth
      const validSnaps = snapPoints.filter(p => p.depth >= minDepth && p.depth <= targetDepth)
      if (validSnaps.length >= 1) {
        const snap = validSnaps.length > 1
          ? this.#findNearestSnapPoint(validSnaps, event.clientX)
          : validSnaps[0]
        const snapContentLeft = snap.pixelLeft + listPadding
        const snapBulletLeft = snapContentLeft - (listPadding / 2) - 1
        // Self-target is only valid when depth actually changes (outdent)
        if (isSelfTarget && snap.depth >= targetDepth) return null
        return { element: resolvedBlock, nodeKey, position, depth: snap.depth, bulletLeft: snapBulletLeft, contentLeft: snapContentLeft }
      }
    }

    // Self-target at same depth is a no-op
    if (isSelfTarget) return null

    // Before/after: place at the target's depth as a sibling
    const bulletLeft = blockLeft - (listPadding / 2) - 1
    return { element: blockElement, nodeKey, position, depth: targetDepth, bulletLeft, contentLeft: blockLeft }
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
      const hasChildren = next && next.classList.contains("lexxy-nested-listitem")

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
  // minDepth prevents list items from snapping to root level (depth 0).
  #getDropSnapPoints(blockElement, position, root, minDepth = 1) {
    const points = []
    const seen = new Set()

    const addPoint = (depth, pixelLeft) => {
      if (depth < minDepth) return
      if (seen.has(depth)) return
      seen.add(depth)
      points.push({ depth, pixelLeft })
    }

    // Depth 0: top-level — only valid for non-list content
    const rootRect = root.getBoundingClientRect()
    const rootPadding = parseFloat(getComputedStyle(root).paddingInlineStart) || 0
    addPoint(0, rootRect.left + rootPadding)

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
      addPoint(i + 1, listAncestors[i].getBoundingClientRect().left)
    }

    return points.sort((a, b) => a.depth - b.depth)
  }

  // Find the snap point whose pixelLeft is closest to the cursor X
  #findNearestSnapPoint(points, clientX) {
    if (points.length === 0) return { depth: 0, pixelLeft: 0 }

    let best = points[0]
    let bestDist = Math.abs(clientX - best.pixelLeft)

    for (let i = 1; i < points.length; i++) {
      const dist = Math.abs(clientX - points[i].pixelLeft)
      if (dist < bestDist) {
        best = points[i]
        bestDist = dist
      }
    }

    return best
  }

  // Count how deep a block element is nested (0 = root child, 1 = in a list, etc.)
  #getElementNestingDepth(element, root) {
    let depth = 0
    let current = element

    while (current && current !== root) {
      if (current.tagName === "UL" || current.tagName === "OL") {
        depth++
      }
      current = current.parentElement
    }

    return depth
  }

  // -- Drop indicator positioning ---------------------------------------------

  #lastIndicatorTop = null
  #lastIndicatorLeft = null

  #showDropIndicator(target) {
    const indicator = this.#dropIndicatorElement
    if (!indicator) return

    const editorRect = this.#editorElement.getBoundingClientRect()
    const blockRect = target.element.getBoundingClientRect()
    const root = this.#editor.getRootElement()
    if (!root) return
    const rootRect = root.getBoundingClientRect()

    let top
    const isSelfOutdent = target.nodeKey === this.#draggedNodeKey
    if (target.position === "before") {
      top = blockRect.top - editorRect.top - 1
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
      // "After" and "inside": show below the target item
      top = blockRect.bottom - editorRect.top - 1
    }

    const left = target.bulletLeft - editorRect.left
    const gap = target.contentLeft - target.bulletLeft - 6

    // Skip if the indicator would barely move — prevents flicker between
    // adjacent "after A" / "before B" targets at the same depth
    if (this.#lastIndicatorTop !== null &&
        Math.abs(top - this.#lastIndicatorTop) < 5 &&
        Math.abs(left - this.#lastIndicatorLeft) < 5) {
      return
    }
    this.#lastIndicatorTop = top
    this.#lastIndicatorLeft = left

    indicator.style.top = `${top}px`
    indicator.style.left = `${left}px`
    indicator.style.right = `${editorRect.right - rootRect.right}px`
    indicator.style.setProperty("--indicator-gap", `${Math.max(0, gap)}px`)

    indicator.dataset.depth = target.depth

    indicator.classList.add("lexxy-drop-indicator--visible")
  }

  #hideDropIndicator() {
    this.#dropIndicatorElement?.classList.remove("lexxy-drop-indicator--visible")
    this.#lastIndicatorTop = null
    this.#lastIndicatorLeft = null
  }

  // -- Drag ghost (floating clone follows cursor) ------------------------------

  #createDragGhost(sourceElement, event) {
    this.#removeDragGhost()
    if (!sourceElement) return

    const rect = sourceElement.getBoundingClientRect()

    // For list items with children, the children live in a structural
    // wrapper sibling. Build a container that includes both the item
    // and its children so the ghost shows the full subtree.
    let ghostContent
    const nextSib = sourceElement.nextElementSibling
    const hasChildren = sourceElement.tagName === "LI" &&
      nextSib && nextSib.classList.contains("lexxy-nested-listitem")

    if (hasChildren) {
      // Wrap in a mini list so the bullets render correctly
      const list = document.createElement(sourceElement.closest("ul, ol")?.tagName || "UL")
      list.appendChild(sourceElement.cloneNode(true))
      list.appendChild(nextSib.cloneNode(true))
      list.style.margin = "0"
      list.style.paddingInlineStart = "1.5em"
      ghostContent = list
    } else if (sourceElement.tagName === "LI") {
      // Single list item — wrap in a list for proper bullet rendering
      const list = document.createElement(sourceElement.closest("ul, ol")?.tagName || "UL")
      list.appendChild(sourceElement.cloneNode(true))
      list.style.margin = "0"
      list.style.paddingInlineStart = "1.5em"
      ghostContent = list
    } else {
      ghostContent = sourceElement.cloneNode(true)
    }

    // Strip selection classes from cloned elements — they carry box-shadows
    // (bullet extensions, gap bridges) that render as dark borders in the ghost.
    for (const el of ghostContent.querySelectorAll(".block--selected, .block--focused")) {
      el.classList.remove("block--selected", "block--focused")
    }
    ghostContent.classList?.remove("block--selected", "block--focused")

    // Wrap in a container with Lexxy's CSS classes so content styles
    // (bullets, headings, code blocks, blockquotes, etc.) render correctly.
    const styleWrapper = document.createElement("div")
    styleWrapper.className = "lexxy-content lexxy-editor__content"
    styleWrapper.appendChild(ghostContent)

    // Copy CSS custom properties from the editor to the ghost so code blocks,
    // colors, etc. render correctly outside the <lexxy-editor> element.
    const editorStyles = getComputedStyle(this.#editorElement)
    const varsToForward = [
      "--lexxy-color-code-bg", "--lexxy-color-code-text", "--lexxy-color-canvas",
      "--lexxy-color-surface", "--lexxy-color-ink", "--lexxy-color-ink-lighter",
      "--lexxy-color-ink-lightest", "--lexxy-color-accent-dark", "--lexxy-focus-ring-color"
    ]
    for (const v of varsToForward) {
      const val = editorStyles.getPropertyValue(v)
      if (val) styleWrapper.style.setProperty(v, val)
    }

    const ghost = document.createElement("div")
    ghost.className = "lexxy-drag-ghost"
    ghost.appendChild(styleWrapper)
    ghost.style.position = "fixed"
    ghost.style.width = `${rect.width + 24}px`
    ghost.style.maxHeight = "280px"
    ghost.style.pointerEvents = "none"
    ghost.style.zIndex = "10000"
    ghost.style.opacity = "1"
    ghost.style.transform = "scale(0.95)"
    ghost.style.transformOrigin = "top left"
    ghost.style.borderRadius = "6px"
    ghost.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)"
    ghost.style.background = "color-mix(in oklch, var(--lexxy-color-accent-dark, #3b82f6) 5%, var(--lexxy-color-canvas, #fff))"
    ghost.style.padding = "4px 8px 8px"
    ghost.style.overflow = "hidden"
    ghost.style.left = `${event.clientX + 12}px`
    ghost.style.top = `${event.clientY - 12}px`
    ghost.style.transition = "opacity 100ms ease"

    document.body.appendChild(ghost)
    this.#dragGhostElement = ghost
  }

  #positionDragGhost(event) {
    if (!this.#dragGhostElement) return
    this.#dragGhostElement.style.left = `${event.clientX + 12}px`
    this.#dragGhostElement.style.top = `${event.clientY - 12}px`
  }

  #removeDragGhost() {
    this.#dragGhostElement?.remove()
    this.#dragGhostElement = null
  }

  // -- Drop execution ---------------------------------------------------------

  #performDrop() {
    const target = this.#dropTarget
    const draggedKey = this.#draggedNodeKey
    if (!target || !draggedKey) return

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
        if (this.#isStructuralWrapper(next)) {
          associatedWrapper = next
          associatedWrapper.remove()
        }
      }

      // For outdent operations (moving to a shallower depth within a list),
      // capture trailing siblings from the original list. Standard outliner
      // behavior: items after the outdented item become its children.
      let trailingSiblings = []
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
          if ($isListItemNode(parentWrapper) && this.#isStructuralWrapper(parentWrapper)) {
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
      this.#cleanupEmptyStructuralWrappers(oldParentList)

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
          const textItem = this.#isStructuralWrapper(ancestor)
            ? ancestor.getPreviousSibling() : ancestor

          if (textItem && $isListItemNode(textItem) && !this.#isStructuralWrapper(textItem)) {
            // The structural wrapper after textItem will become nodeToInsert's children
            const existingWrapper = textItem.getNextSibling()
            const reparenting = existingWrapper && this.#isStructuralWrapper(existingWrapper)

            textItem.insertAfter(nodeToInsert)

            if (reparenting && associatedWrapper) {
              // Merge: nodeToInsert has its own children AND is adopting
              // the former parent's children. Put associatedWrapper first,
              // then append the re-parented children into the same list.
              nodeToInsert.insertAfter(associatedWrapper)
              const assocList = associatedWrapper.getChildren().find(c => $isListNode(c))
              const existingList = existingWrapper.getChildren().find(c => $isListNode(c))
              if (assocList && existingList) {
                for (const child of [...existingList.getChildren()]) {
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
          if (nextSib && this.#isStructuralWrapper(nextSib)) {
            targetNode.insertAfter(nodeToInsert)
            // existingWrapper stays in place → now after nodeToInsert → children transfer
            if (associatedWrapper) {
              nodeToInsert.insertAfter(associatedWrapper)
              const assocList = associatedWrapper.getChildren().find(c => $isListNode(c))
              const existingList = nextSib.getChildren().find(c => $isListNode(c))
              if (assocList && existingList) {
                for (const child of [...existingList.getChildren()]) {
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
      } catch (e) {
        console.error("[BlockDragAndDrop] Drop update error:", e)
      }
    }, { tag: "history-push" })
  }

  // Outdent-in-place: promote the dragged node to a shallower depth
  // without re-parenting the parent's existing children. Inserts AFTER
  // the structural wrapper at the target depth (rather than between the
  // text item and its wrapper, which would adopt children).
  #performSelfOutdent(draggedNode, desiredDepth) {
    const ancestor = this.#findInsertionAncestor(draggedNode, desiredDepth)

    // Save references before any mutations
    const textItem = this.#isStructuralWrapper(ancestor)
      ? ancestor.getPreviousSibling() : ancestor
    const structuralWrapper = this.#isStructuralWrapper(ancestor)
      ? ancestor
      : (textItem?.getNextSibling() && this.#isStructuralWrapper(textItem.getNextSibling())
        ? textItem.getNextSibling() : null)

    // Detach the dragged node's own children (structural wrapper after it)
    let associatedWrapper = null
    const next = draggedNode.getNextSibling()
    if (next && this.#isStructuralWrapper(next)) {
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
      this.#isStructuralWrapper(oldParentWrapper)) ? oldParentWrapper.getKey() : null

    draggedNode.remove()

    // Clean up the parent wrapper chain. Check by key since Lexical
    // normalization may have converted the wrapper to a regular item.
    if (oldWrapperKey) {
      const wrapper = $getNodeByKey(oldWrapperKey)
      if (wrapper && wrapper.getParent()) {
        const grandparentList = wrapper.getParent()
        if (this.#isStructuralWrapper(wrapper)) {
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
    while (this.#isStructuralWrapper(next)) {
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
    for (const child of [...list.getChildren()]) {
      if (!$isListItemNode(child)) continue
      if (this.#isStructuralWrapper(child)) {
        // Structural wrapper — remove if all inner lists are empty
        if (child.getChildren().every(inner => $isListNode(inner) && inner.getChildrenSize() === 0)) {
          child.remove()
        }
      } else if (child.getTextContentSize() === 0) {
        // Lexical may normalize an emptied structural wrapper into a
        // regular list item with an empty paragraph. Detect these by
        // checking for zero text content + only paragraph children.
        const kids = child.getChildren()
        if (kids.length <= 1 && kids.every(k => $isParagraphNode(k))) {
          // Check the CSS class on the DOM element — if it still has
          // lexxy-nested-listitem, it was a structural wrapper.
          const el = this.#editor.getElementByKey(child.getKey())
          if (el?.classList.contains("lexxy-nested-listitem")) {
            child.remove()
          }
        }
      }
    }
    if (list.getChildrenSize() === 0) {
      const parentWrapper = list.getParent()
      if (this.#isStructuralWrapper(parentWrapper)) {
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

  // Get the nesting depth of a Lexical node (number of ListNode ancestors)
  #getNodeDepth(node) {
    let depth = 0
    let current = node.getParent()
    while (current) {
      if ($isListNode(current)) depth++
      current = current.getParent()
    }
    return depth
  }

  // Nest a node as the first child of the target's sub-list.
  #nestInsideTarget(nodeToInsert, targetNode) {
    if ($isListItemNode(targetNode)) {
      // Find existing structural wrapper with nested list after the target
      let nestedList = null
      const nextSibling = targetNode.getNextSibling()
      if (this.#isStructuralWrapper(nextSibling)) {
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
      if (this.#isStructuralWrapper(nodeToInsert)) {
        const innerList = nodeToInsert.getChildren()[0]
        const firstChild = nestedList.getFirstChild()
        for (const child of [...innerList.getChildren()]) {
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
        const items = [...nodeToInsert.getChildren()]
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
      if (this.#isStructuralWrapper(draggedNode)) {
        // Dig into the structural wrapper to find the actual content
        const children = draggedNode.getChildren()
        const innerList = children[0]
        const innerItems = innerList.getChildren()
        const contentItem = innerItems.find(child =>
          $isListItemNode(child) && !this.#isStructuralWrapper(child)
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

  // -- Auto-scroll during drag ------------------------------------------------

  #stickyTopOffset = 0

  #findScrollableContainers() {
    const containers = []
    let current = this.#editorElement.parentElement

    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current)
      const overflowY = style.overflowY
      if ((overflowY === "auto" || overflowY === "scroll") &&
          current.scrollHeight > current.clientHeight) {
        containers.push(current)
      }
      current = current.parentElement
    }

    // Always include viewport (window-level scrolling)
    containers.push(null)

    // Detect sticky/fixed headers that occlude the top of the viewport.
    // Probe from the top center downward; for each hit element, walk its
    // ancestor chain to find any fixed/sticky container.
    this.#stickyTopOffset = 0
    const probeX = window.innerWidth / 2
    for (let y = 0; y < 200; y += 4) {
      const el = document.elementFromPoint(probeX, y)
      if (!el) continue

      let fixedAncestor = null
      let walk = el
      while (walk && walk !== document.documentElement) {
        const pos = getComputedStyle(walk).position
        if (pos === "fixed" || pos === "sticky") {
          fixedAncestor = walk
          break
        }
        walk = walk.parentElement
      }

      if (fixedAncestor) {
        const bottom = fixedAncestor.getBoundingClientRect().bottom
        if (bottom > this.#stickyTopOffset) this.#stickyTopOffset = bottom
      } else {
        break
      }
    }

    return containers
  }

  #getScrollSpeed(distFromEdge) {
    if (distFromEdge >= SCROLL_EDGE_SIZE || distFromEdge < 0) return 0
    const ratio = 1 - (distFromEdge / SCROLL_EDGE_SIZE)
    return Math.round(SCROLL_MAX_SPEED * ratio * ratio)
  }

  #autoScrollTick = () => {
    if (!this.#isDragging) {
      this.#scrollRafId = null
      return
    }

    const clientX = this.#lastPointerX
    const clientY = this.#lastPointerY
    let didScroll = false

    for (const container of this.#scrollableContainers) {
      const isViewport = container === null

      const rect = isViewport
        ? { top: this.#stickyTopOffset, bottom: window.innerHeight, left: 0, right: window.innerWidth }
        : container.getBoundingClientRect()

      if (clientX < rect.left || clientX > rect.right) continue

      // Check if pointer can actually scroll this container
      const canScrollUp = isViewport ? window.scrollY > 0 : container.scrollTop > 0
      const canScrollDown = isViewport
        ? (window.scrollY + window.innerHeight) < document.documentElement.scrollHeight
        : (container.scrollTop + container.clientHeight) < container.scrollHeight

      const distFromTop = clientY - rect.top
      if (canScrollUp && distFromTop >= 0 && distFromTop < SCROLL_EDGE_SIZE) {
        const speed = this.#getScrollSpeed(distFromTop)
        if (speed > 0) {
          if (isViewport) {
            window.scrollBy(0, -speed)
          } else {
            container.scrollTop -= speed
          }
          didScroll = true
        }
      }

      const distFromBottom = rect.bottom - clientY
      if (canScrollDown && distFromBottom >= 0 && distFromBottom < SCROLL_EDGE_SIZE) {
        const speed = this.#getScrollSpeed(distFromBottom)
        if (speed > 0) {
          if (isViewport) {
            window.scrollBy(0, speed)
          } else {
            container.scrollTop += speed
          }
          didScroll = true
        }
      }
    }

    // Scrolling moved elements relative to the pointer — update drop target
    if (didScroll) {
      this.#updateDropIndicator({ clientX, clientY })
    }

    this.#scrollRafId = requestAnimationFrame(this.#autoScrollTick)
  }

  #startAutoScroll() {
    this.#scrollableContainers = this.#findScrollableContainers()
    if (!this.#scrollRafId) {
      this.#scrollRafId = requestAnimationFrame(this.#autoScrollTick)
    }
  }

  #stopAutoScroll() {
    if (this.#scrollRafId) {
      cancelAnimationFrame(this.#scrollRafId)
      this.#scrollRafId = null
    }
    this.#scrollableContainers = null
  }

  // A structural wrapper is a ListItemNode whose only children are ListNodes
  // (no text content — it holds nested lists for sibling items' children).
  #isStructuralWrapper(node) {
    if (!$isListItemNode(node)) return false
    const kids = node.getChildren()
    return kids.length > 0 && kids.every(c => $isListNode(c))
  }

  // -- Utilities --------------------------------------------------------------

  #getNodeKeyFromElement(element) {
    const keyProp = Object.keys(element).find(k => k.startsWith("__lexicalKey_"))
    if (keyProp) return element[keyProp]
    return element.dataset?.lexicalNodeKey || null
  }

  #cleanup() {
    this.#stopAutoScroll()
    this.#hideDropIndicator()
    this.#removeDragGhost()

    document.removeEventListener("pointermove", this.#onDragMove)
    window.removeEventListener("pointerup", this.#onDragEnd, true)
    window.removeEventListener("pointercancel", this.#onDragEnd, true)
    window.removeEventListener("mouseup", this.#onDragEnd, true)
    document.removeEventListener("keydown", this.#onDragKeydown)

    // Remove lexxy-dragging from ALL elements that have it.
    for (const el of this.#editorElement.querySelectorAll(".lexxy-dragging")) {
      el.classList.remove("lexxy-dragging")
    }

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

    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId)
      this.#rafId = null
    }
  }
}
