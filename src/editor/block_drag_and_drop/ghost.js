import { createElement } from "../../helpers/html_helper"
import { BLOCK_FOCUSED_CLASS, BLOCK_SELECTED_CLASS, NESTED_LISTITEM_CLASS } from "../block_helpers"

// Floating preview element that follows the cursor during a block drag.
// Built once at drag start by cloning the source block (and its nested-list
// children if it's a list item with a structural wrapper sibling), wrapped
// in a `.lexxy-content` container so inherited content styles (bullets,
// headings, code blocks) render correctly outside the editor.
//
// The ghost is a sibling of <body>, not inside <lexxy-editor>, so CSS custom
// properties are forwarded explicitly.
export class DragGhost {
  #editorElement
  #element = null

  constructor(editorElement) {
    this.#editorElement = editorElement
  }

  get element() {
    return this.#element
  }

  create(sourceElement, event) {
    this.remove()
    if (!sourceElement) return

    const rect = sourceElement.getBoundingClientRect()

    // For list items with children, the children live in a structural
    // wrapper sibling. Build a container that includes both the item
    // and its children so the ghost shows the full subtree.
    let ghostContent
    const nextSib = sourceElement.nextElementSibling
    const hasChildren = sourceElement.tagName === "LI" &&
      nextSib && nextSib.classList.contains(NESTED_LISTITEM_CLASS)

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
    for (const el of ghostContent.querySelectorAll(".lexxy-editor__block--selected, .lexxy-editor__block--focused")) {
      el.classList.remove(BLOCK_SELECTED_CLASS, BLOCK_FOCUSED_CLASS)
    }
    ghostContent.classList?.remove(BLOCK_SELECTED_CLASS, BLOCK_FOCUSED_CLASS)

    // Wrap in a container with Lexxy's CSS classes so content styles
    // (bullets, headings, code blocks, blockquotes, etc.) render correctly.
    const styleWrapper = createElement("div", { className: "lexxy-content lexxy-editor__content" })
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

    const ghost = createElement("div", { className: "lexxy-drag-ghost" })
    ghost.appendChild(styleWrapper)
    ghost.style.width = `${rect.width + 16}px`
    ghost.style.left = `${event.clientX + 12}px`
    ghost.style.top = `${event.clientY - 12}px`
    ghost.style.transition = "opacity 100ms ease"

    document.body.appendChild(ghost)
    this.#element = ghost
  }

  position(event) {
    if (!this.#element) return
    this.#element.style.left = `${event.clientX + 12}px`
    this.#element.style.top = `${event.clientY - 12}px`
  }

  remove() {
    this.#element?.remove()
    this.#element = null
  }
}
