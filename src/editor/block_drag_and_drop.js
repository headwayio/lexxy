import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $setSelection,
  $splitNode,
  HISTORY_MERGE_TAG
} from "lexical"
import { $isListItemNode, $isListNode } from "@lexical/list"

const GRIP_ICON = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <circle cx="2" cy="2" r="1.5"/>
  <circle cx="8" cy="2" r="1.5"/>
  <circle cx="2" cy="7" r="1.5"/>
  <circle cx="8" cy="7" r="1.5"/>
  <circle cx="2" cy="12" r="1.5"/>
  <circle cx="8" cy="12" r="1.5"/>
</svg>`

export class BlockDragAndDrop {
  #editor
  #editorElement
  #blockSelectionExtension
  #handleElement = null
  #currentHoveredBlock = null
  #isDragging = false
  #draggedNodeKey = null
  #rafId = null
  #dropTarget = null
  #cleanupFns = []

  constructor(editor, editorElement, blockSelectionExtension) {
    this.#editor = editor
    this.#editorElement = editorElement
    this.#blockSelectionExtension = blockSelectionExtension

    this.#createHandleElement()
    this.#registerListeners()
  }

  destroy() {
    this.#cleanup()
    this.#handleElement?.remove()
    for (const fn of this.#cleanupFns) fn()
    this.#cleanupFns = []
  }

  // -- Handle element ---------------------------------------------------------

  #createHandleElement() {
    this.#editorElement.querySelector(".lexxy-block-handle")?.remove()

    this.#handleElement = document.createElement("div")
    this.#handleElement.className = "lexxy-block-handle"
    this.#handleElement.setAttribute("aria-hidden", "true")
    this.#handleElement.innerHTML = GRIP_ICON

    this.#handleElement.addEventListener("pointerdown", this.#onHandlePointerDown)

    this.#editorElement.appendChild(this.#handleElement)
  }

  #positionHandle(blockElement) {
    if (!this.#handleElement || !blockElement) return

    const editorRect = this.#editorElement.getBoundingClientRect()
    const blockRect = blockElement.getBoundingClientRect()

    const top = blockRect.top - editorRect.top

    this.#handleElement.style.top = `${top}px`
    this.#handleElement.classList.add("lexxy-block-handle--visible")
  }

  #hideHandle() {
    if (this.#handleElement) {
      this.#handleElement.classList.remove("lexxy-block-handle--visible")
    }
    this.#currentHoveredBlock = null
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

  #onMouseLeave = () => {
    if (!this.#isDragging) {
      this.#hideHandle()
    }
  }

  #updateHoveredBlock(event) {
    const root = this.#editor.getRootElement()
    if (!root) return

    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (!element || !root.contains(element)) {
      this.#hideHandle()
      return
    }

    const blockElement = this.#findNearestBlockElement(element, root)
    if (!blockElement || blockElement === this.#currentHoveredBlock) {
      if (!blockElement) this.#hideHandle()
      return
    }

    this.#currentHoveredBlock = blockElement
    this.#positionHandle(blockElement)
  }

  // Find the nearest selectable block element: list items, or top-level blocks
  #findNearestBlockElement(element, root) {
    let current = element
    while (current && current !== root) {
      // List items are individually selectable blocks
      if (current.tagName === "LI" && root.contains(current)) {
        return current
      }
      // Top-level children of the root
      if (current.parentElement === root) {
        return current
      }
      current = current.parentElement
    }
    return null
  }

  // -- Drag initiation --------------------------------------------------------

  #onHandlePointerDown = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!this.#currentHoveredBlock) return

    const nodeKey = this.#getNodeKeyFromElement(this.#currentHoveredBlock)
    if (!nodeKey) return

    this.#isDragging = true
    this.#draggedNodeKey = nodeKey

    this.#blockSelectionExtension.enterBlockSelectMode(nodeKey)

    this.#currentHoveredBlock.classList.add("lexxy-dragging")

    this.#handleElement.setPointerCapture(event.pointerId)

    document.addEventListener("pointermove", this.#onDragMove)
    document.addEventListener("pointerup", this.#onDragEnd)
    document.addEventListener("pointercancel", this.#onDragEnd)
  }

  #onDragMove = (event) => {
    if (!this.#isDragging) return

    event.preventDefault()

    if (!this.#rafId) {
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null
        this.#updateDropIndicator(event)
      })
    }
  }

  #onDragEnd = () => {
    if (!this.#isDragging) return

    document.removeEventListener("pointermove", this.#onDragMove)
    document.removeEventListener("pointerup", this.#onDragEnd)
    document.removeEventListener("pointercancel", this.#onDragEnd)

    if (this.#dropTarget && this.#draggedNodeKey) {
      this.#performDrop()
    }

    this.#cleanup()
  }

  // -- Drop target resolution -------------------------------------------------

  #updateDropIndicator(event) {
    this.#clearDropIndicators()

    const target = this.#resolveDropTarget(event)
    this.#dropTarget = target

    if (!target) return

    target.element.classList.add(`lexxy-block-drop-target--${target.position}`)
  }

  #resolveDropTarget(event) {
    const root = this.#editor.getRootElement()
    if (!root) return null

    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (!element || !root.contains(element)) return null

    // Find the nearest block element (including list items)
    const blockElement = this.#findNearestBlockElement(element, root)
    if (!blockElement) return null

    const nodeKey = this.#getNodeKeyFromElement(blockElement)
    if (!nodeKey || nodeKey === this.#draggedNodeKey) return null

    const position = this.#computeVerticalPosition(blockElement, event.clientY)
    const type = blockElement.tagName === "LI" ? "list-item" : "block"

    return { type, element: blockElement, nodeKey, position }
  }

  #computeVerticalPosition(element, clientY) {
    const rect = element.getBoundingClientRect()
    return clientY < rect.top + rect.height / 2 ? "before" : "after"
  }

  // -- Drop execution ---------------------------------------------------------

  #performDrop() {
    const target = this.#dropTarget
    const draggedKey = this.#draggedNodeKey
    if (!target || !draggedKey) return

    this.#editor.update(() => {
      const draggedNode = $getNodeByKey(draggedKey)
      if (!draggedNode) return

      const targetNode = target.nodeKey ? $getNodeByKey(target.nodeKey) : null
      if (!targetNode) return

      if (draggedNode.is(targetNode)) return

      const sourceParent = draggedNode.getParent()
      draggedNode.remove()

      if (target.position === "before") {
        targetNode.insertBefore(draggedNode)
      } else {
        targetNode.insertAfter(draggedNode)
      }

      // Cleanup empty source list
      if ($isListNode(sourceParent) && sourceParent.getChildrenSize() === 0) {
        sourceParent.remove()
      }

      $setSelection(null)
    }, { tag: HISTORY_MERGE_TAG })
  }

  // -- Drop indicators --------------------------------------------------------

  static #DROP_CLASSES = [
    "lexxy-block-drop-target--before",
    "lexxy-block-drop-target--after"
  ]

  #clearDropIndicators() {
    const root = this.#editor.getRootElement()
    if (!root) return

    for (const el of root.querySelectorAll("[class*='lexxy-block-drop-target--']")) {
      el.classList.remove(...BlockDragAndDrop.#DROP_CLASSES)
    }
  }

  // -- Utilities --------------------------------------------------------------

  #getNodeKeyFromElement(element) {
    const keyProp = Object.keys(element).find(k => k.startsWith("__lexicalKey_"))
    if (keyProp) return element[keyProp]
    return element.dataset?.lexicalNodeKey || null
  }

  #cleanup() {
    this.#clearDropIndicators()

    if (this.#draggedNodeKey) {
      const el = this.#editor.getElementByKey(this.#draggedNodeKey)
      el?.classList.remove("lexxy-dragging")
    }

    this.#isDragging = false
    this.#draggedNodeKey = null
    this.#dropTarget = null

    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId)
      this.#rafId = null
    }
  }
}
