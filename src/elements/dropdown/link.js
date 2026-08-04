import { $getSelection, $isRangeSelection, $setSelection } from "lexical"
import { LinkNode } from "@lexical/link"
import { ToolbarDropdown } from "../toolbar_dropdown"
import { registerEventListener } from "../../helpers/listener_helper"

export class LinkDropdown extends ToolbarDropdown {
  #savedSelection = null

  editorReady() {
    this.input = this.panel.querySelector("input")

    this.track(
      registerEventListener(this.input, "keydown", this.#handleEnter),
      registerEventListener(this.linkButton, "click", this.#handleLink),
      registerEventListener(this.unlinkButton, "click", this.#handleUnlink)
    )
  }

  onOpen() {
    // Opening moves focus into the URL input, which loses the editor's
    // selection. Save it now and restore it before dispatching, so the link
    // wraps the text the user had highlighted.
    this.#saveSelection()
    this.input.value = this.#selectedLinkUrl
    this.input.required = true
  }

  onClose() {
    this.input.required = false
    this.#savedSelection = null
  }

  get linkButton() {
    return this.panel.querySelector("[value='link']")
  }

  get unlinkButton() {
    return this.panel.querySelector("[value='unlink']")
  }

  #saveSelection() {
    this.#savedSelection = null
    this.editor.getEditorState().read(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        this.#savedSelection = selection.clone()
      }
    })
  }

  #restoreSavedSelection() {
    const saved = this.#savedSelection
    if (!saved) return

    this.editor.update(() => {
      try {
        $setSelection(saved.clone())
      } catch {
        // The selected nodes no longer exist — fall back to current selection
      }
    })
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

    this.#restoreSavedSelection()
    this.editor.dispatchCommand("link", this.input.value)
    this.close()
  }

  #handleUnlink = () => {
    this.#restoreSavedSelection()
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
