import { nextFrame } from "../helpers/timing_helpers"

export class ToolbarDropdown extends HTMLElement {
  connectedCallback() {
    // Defer to next microtask — when dynamically created editors build the
    // toolbar via createElement + innerHTML (#createDefaultToolbar in editor.js),
    // connectedCallback fires for child custom elements (LinkDropdown,
    // HighlightDropdown) during innerHTML parsing, BEFORE the toolbar is
    // prepended to the document. At that point this.closest("details") returns
    // null because the element isn't connected yet. The microtask runs after
    // the full tree is inserted into the DOM.
    queueMicrotask(() => {
      this.container = this.closest("details")
      if (!this.container) return

      this.container.addEventListener("toggle", this.#handleToggle.bind(this))
      this.container.addEventListener("keydown", this.#handleKeyDown.bind(this))

      this.#onToolbarEditor(this.initialize.bind(this))
    })
  }

  disconnectedCallback() {
    this.container?.removeEventListener("keydown", this.#handleKeyDown.bind(this))
  }

  get toolbar() {
    return this.closest("lexxy-toolbar")
  }

  get editorElement() {
    return this.toolbar.editorElement
  }

  get editor() {
    return this.toolbar.editor
  }

  initialize() {
    // Any post-editor initialization
  }

  close() {
    this.editor.focus()
    this.container.open = false
  }

  async #onToolbarEditor(callback) {
    await this.toolbar.editorConnected
    callback()
  }

  #handleToggle() {
    if (this.container.open) {
      this.#handleOpen()
    }
  }

  async #handleOpen() {
    this.#interactiveElements[0].focus()
    this.#resetTabIndexValues()
  }

  #handleKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation()
      this.close()
    }
  }

  async #resetTabIndexValues() {
    await nextFrame()
    this.#buttons.forEach((element, index) => {
      element.setAttribute("tabindex", index === 0 ? 0 : "-1")
    })
  }

  get #interactiveElements() {
    return Array.from(this.querySelectorAll("button, input"))
  }

  get #buttons() {
    return Array.from(this.querySelectorAll("button"))
  }
}

export default ToolbarDropdown
