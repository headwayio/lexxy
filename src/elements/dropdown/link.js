import { $getSelection, $isRangeSelection, $setSelection } from "lexical"
import { $isLinkNode } from "@lexical/link"
import { ToolbarDropdown } from "../toolbar_dropdown"

export class LinkDropdown extends ToolbarDropdown {
  _savedSelectionRect = null
  _savedLexicalSelection = null
  _savedNativeRange = null

  connectedCallback() {
    super.connectedCallback()
    this.input = this.querySelector("input")

    this.#registerHandlers()
  }

  #registerHandlers() {
    this.container.addEventListener("toggle", this.#handleToggle.bind(this))
    this.addEventListener("submit", this.#handleSubmit.bind(this))
    this.input.addEventListener("keydown", this.#handleInputKeydown.bind(this))
    this.querySelector("[value='unlink']").addEventListener("click", this.#handleUnlink.bind(this))

    // Save the selection before the details element steals focus
    this.container.querySelector("summary").addEventListener("pointerdown", () => this.#saveSelection())
    this.editorElement.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        this.#saveSelection()
      }
    })
  }

  #handleToggle({ newState }) {
    this.input.value = this.#selectedLinkUrl
    this.input.required = newState === "open"

    if (newState === "open") {
      this.container.setAttribute("data-pinned", "")
      this.#showSelectionHighlight()
      this.#positionNearSelection()
      requestAnimationFrame(() => this.input.focus())
    } else {
      this.container.removeAttribute("data-pinned")
      this.#clearSelectionHighlight()
    }
  }

  #handleInputKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      this.querySelector("button[value='link']").click()
    }
  }

  #handleSubmit(event) {
    const command = event.submitter?.value
    const url = this.#normalizeUrl(this.input.value)
    if (!url) return

    this.#clearSelectionHighlight()

    // Restore the Lexical selection so the link wraps the correct text
    if (this._savedLexicalSelection) {
      this.editor.update(() => {
        $setSelection(this._savedLexicalSelection)
      })
    }

    this.editor.dispatchCommand(command, url)
    this.close()
  }

  #normalizeUrl(value) {
    const trimmed = value.trim()
    if (!trimmed) return null

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
    if (trimmed.includes(".")) return `https://${trimmed}`

    return null
  }

  #handleUnlink() {
    this.#clearSelectionHighlight()
    this.editor.dispatchCommand("unlink")
    this.close()
  }

  #saveSelection() {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      this._savedNativeRange = selection.getRangeAt(0).cloneRange()
      this._savedSelectionRect = this._savedNativeRange.getBoundingClientRect()
    }
    this.editor.getEditorState().read(() => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) {
        this._savedLexicalSelection = sel.clone()
      }
    })
  }

  #showSelectionHighlight() {
    if (!this._savedNativeRange || !CSS.highlights) return

    const highlight = new Highlight(this._savedNativeRange)
    CSS.highlights.set("lexxy-link-selection", highlight)
  }

  #clearSelectionHighlight() {
    CSS.highlights?.delete("lexxy-link-selection")
  }

  #positionNearSelection() {
    const rect = this._savedSelectionRect
    if (!rect || (rect.width === 0 && rect.height === 0)) return

    this.style.position = "fixed"
    this.style.insetInlineEnd = "auto"

    requestAnimationFrame(() => {
      const popRect = this.getBoundingClientRect()
      let top = rect.top - popRect.height - 6
      let left = rect.left

      if (top < 8) {
        top = rect.bottom + 6
      }

      if (left + popRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - popRect.width - 8)
      }

      this.style.insetBlockStart = `${top}px`
      this.style.insetInlineStart = `${left}px`
    })
  }

  get #selectedLinkUrl() {
    let url = ""

    this.editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      let node = selection.getNodes()[0]
      while (node && node.getParent()) {
        if ($isLinkNode(node)) {
          url = node.getURL()
          break
        }
        node = node.getParent()
      }
    })

    return url
  }
}

export default LinkDropdown
