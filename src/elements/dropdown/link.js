import { LinkNode } from "@lexical/link"
import { ToolbarDropdown } from "../toolbar_dropdown"
import { registerEventListener } from "../../helpers/listener_helper"

export class LinkDropdown extends ToolbarDropdown {
  #savedSelectionRects = null
  #highlightOverlays = null

  editorReady() {
    this.input = this.panel.querySelector("input")

    this.track(
      registerEventListener(this.input, "keydown", this.#handleEnter),
      registerEventListener(this.linkButton, "click", this.#handleLink),
      registerEventListener(this.unlinkButton, "click", this.#handleUnlink),
      // Capture the selection geometry on pointerdown, before opening the
      // panel moves focus and collapses the visible selection.
      registerEventListener(this.trigger, "pointerdown", this.#saveSelectionRects),
      registerEventListener(this.editorElement, "keydown", this.#saveSelectionRectsOnShortcut)
    )
  }

  onOpen() {
    this.input.value = this.#selectedLinkUrl
    this.input.required = true
    this.#showSelectionHighlight()
  }

  onClose() {
    this.input.required = false
    this.#clearSelectionHighlight()
  }

  // Focus moves to the URL field as soon as the panel opens, so the browser
  // stops painting the text selection and the user loses sight of what they
  // are about to link. Re-draw it as overlay rectangles for the panel's
  // lifetime.
  #saveSelectionRects = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      this.#savedSelectionRects = null
      return
    }

    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 0

    // Snapshot now: once Lexical reconciles, the range's nodes may be replaced
    // and getClientRects() comes back empty. Grow each rect to the full line
    // height so the overlay matches what the browser had been painting.
    this.#savedSelectionRects = Array.from(range.getClientRects())
      .filter(rect => rect.width > 0)
      .map(rect => {
        const grow = lineHeight > rect.height ? (lineHeight - rect.height) / 2 : 0
        return { left: rect.left, top: rect.top - grow, width: rect.width, height: rect.height + grow * 2 }
      })
  }

  #saveSelectionRectsOnShortcut = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "k") this.#saveSelectionRects()
  }

  #showSelectionHighlight() {
    this.#clearSelectionHighlight()
    if (!this.#savedSelectionRects?.length) return

    const editorElement = this.editorElement
    const editorRect = editorElement.getBoundingClientRect()

    this.#highlightOverlays = this.#savedSelectionRects.map((rect) => {
      const overlay = document.createElement("div")
      overlay.className = "lexxy-link-selection-overlay"
      overlay.style.left = `${rect.left - editorRect.left - editorElement.clientLeft}px`
      overlay.style.top = `${rect.top - editorRect.top - editorElement.clientTop + editorElement.scrollTop}px`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
      editorElement.appendChild(overlay)
      return overlay
    })
  }

  #clearSelectionHighlight() {
    this.#highlightOverlays?.forEach(overlay => overlay.remove())
    this.#highlightOverlays = null
  }

  get linkButton() {
    return this.panel.querySelector("[value='link']")
  }

  get unlinkButton() {
    return this.panel.querySelector("[value='unlink']")
  }

  #handleEnter = (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      this.#handleLink(event)
    }
  }

  #handleLink = () => {
    if (!this.input.checkValidity()) {
      this.input.reportValidity()
      return
    }

    this.editor.dispatchCommand("link", this.input.value)
    this.close()
  }

  #handleUnlink = () => {
    this.editor.dispatchCommand("unlink")
    this.close()
  }

  get #selectedLinkUrl() {
    return this.editor.getEditorState().read(() => {
      const linkNode = this.editorElement.selection.nearestNodeOfType(LinkNode)
      return linkNode?.getURL() ?? ""
    })
  }
}

export default LinkDropdown
