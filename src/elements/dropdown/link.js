import { $getSelection, $isRangeSelection, $setSelection } from "lexical"
import { $isLinkNode } from "@lexical/link"
import { ToolbarDropdown } from "../toolbar_dropdown"

export class LinkDropdown extends ToolbarDropdown {
  _savedSelectionRect = null
  _savedSelectionRects = null
  _savedLexicalSelection = null

  connectedCallback() {
    super.connectedCallback()
    // Setup moved to initialize() — connectedCallback runs before the base
    // class has resolved this.container (deferred via queueMicrotask).
    // initialize() is called after the editor is connected and container is set.
  }

  initialize() {
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
    // Pin the dropdown immediately — before the details opens — so the
    // toolbar's update-listener closeDropdowns() won't close it mid-open
    this.container.setAttribute("data-pinned", "")

    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      this._savedSelectionRect = range.getBoundingClientRect()

      // Compute line-height to expand rects to full selection height
      const container = range.commonAncestorContainer
      const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 0

      // Save rects now — after Lexical reconciles the DOM, the range nodes
      // may be replaced and getClientRects() would return empty.
      // Expand each rect vertically to match the full line-height.
      this._savedSelectionRects = Array.from(range.getClientRects()).map(r => {
        const expand = lineHeight > r.height ? (lineHeight - r.height) / 2 : 0
        return { left: r.left, top: r.top - expand, width: r.width, height: r.height + expand * 2 }
      })
    }
    this.editor.getEditorState().read(() => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) {
        this._savedLexicalSelection = sel.clone()
      }
    })
  }

  #showSelectionHighlight() {
    if (!this._savedSelectionRects?.length) return

    this._highlightOverlays = []
    const editorEl = this.editorElement
    const editorRect = editorEl.getBoundingClientRect()

    for (const rect of this._savedSelectionRects) {
      if (rect.width === 0) continue

      const overlay = document.createElement("div")
      overlay.className = "lexxy-link-selection-overlay"
      overlay.style.left = `${rect.left - editorRect.left - editorEl.clientLeft}px`
      overlay.style.top = `${rect.top - editorRect.top - editorEl.clientTop + editorEl.scrollTop}px`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
      editorEl.appendChild(overlay)
      this._highlightOverlays.push(overlay)
    }
  }

  #clearSelectionHighlight() {
    if (this._highlightOverlays) {
      this._highlightOverlays.forEach(el => el.remove())
      this._highlightOverlays = null
    }
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
