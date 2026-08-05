import { createElement } from "../../../helpers/html_helper"
import { BLOCK_FOCUSED_CLASS, BLOCK_SELECTED_CLASS, NESTED_LISTITEM_CLASS } from "../../block_helpers"

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

  create(sourceElement, event, extraElements = []) {
    this.remove()
    if (!sourceElement) return

    const rect = sourceElement.getBoundingClientRect()

    // Build ghost content for ONE element (the grabbed one or any
    // extra selected one). Returns a DOM node ready to append to
    // the ghost's container. List items get wrapped in a mini list
    // so bullets/numbers render; non-list blocks pass through.
    function buildOne(el) {
      const sib = el.nextElementSibling
      const hasChildren = el.tagName === "LI"
        && sib && sib.classList.contains(NESTED_LISTITEM_CLASS)
      if (hasChildren) {
        const list = document.createElement(el.closest("ul, ol")?.tagName || "UL")
        list.appendChild(el.cloneNode(true))
        list.appendChild(sib.cloneNode(true))
        list.style.margin = "0"
        list.style.paddingInlineStart = "1.5em"
        return list
      }
      if (el.tagName === "LI") {
        const list = document.createElement(el.closest("ul, ol")?.tagName || "UL")
        list.appendChild(el.cloneNode(true))
        list.style.margin = "0"
        list.style.paddingInlineStart = "1.5em"
        return list
      }
      return el.cloneNode(true)
    }

    // Multi-block: stack each selected block's clone inside a
    // single ghost container so the user sees the full extent of
    // what's about to move. Single-block: just the one source.
    let ghostContent
    if (extraElements.length > 0) {
      const stack = document.createElement("div")
      stack.appendChild(buildOne(sourceElement))
      for (const el of extraElements) {
        if (el && el !== sourceElement) stack.appendChild(buildOne(el))
      }
      ghostContent = stack
    } else {
      ghostContent = buildOne(sourceElement)
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
