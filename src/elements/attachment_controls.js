import { $getNearestNodeFromDOMNode } from "lexical"
import { createElement } from "../helpers/html_helper"
import { dispatchAttachmentPreview } from "../helpers/attachment_preview_helper"
import { $isActionTextAttachmentNode } from "../nodes/action_text_attachment_node"
import { $isImageGalleryNode } from "../nodes/image_gallery_node"
import AttachmentIcons from "./attachment_icons"

export class AttachmentControls extends HTMLElement {
  connectedCallback() {
    this.editorElement = this.closest("lexxy-editor")
    this.editor = this.editorElement.editor
    this.classList.add("lexxy-floating-controls")

    if (!this.querySelector(".lexxy-node-delete")) {
      this.#attachButtons()
    }
  }

  disconnectedCallback() {
    this.editor = null
    this.editorElement = null
  }

  #attachButtons() {
    const container = createElement("div", { className: "lexxy-floating-controls__group" })

    container.appendChild(this.#floatingButton("lexxy-node-preview", "Open", AttachmentIcons.preview, () => this.#openPreview()))

    if (this.#isPreviewAttachment) {
      this.collapseButton = this.#floatingButton("lexxy-node-collapse", "Collapse preview", AttachmentIcons.collapse, () => this.#toggleCollapse())
      container.appendChild(this.collapseButton)
    }

    container.appendChild(this.#floatingButton("lexxy-node-edit", "Edit name", AttachmentIcons.edit, () => this.#triggerNameEdit()))

    this.captionButton = this.#floatingButton("lexxy-node-caption-toggle", "Hide caption", AttachmentIcons.captionShow, () => this.#toggleCaption())
    container.appendChild(this.captionButton)

    container.appendChild(this.#floatingButton("lexxy-node-delete", "Remove", AttachmentIcons.delete, () => this.#deleteNode()))

    this.appendChild(container)

    // Sync initial button state (collapsed/caption-hidden) from the Lexical node.
    // Deferred to next frame because the Lexical node may not be registered yet
    // when connectedCallback fires during DOM construction.
    requestAnimationFrame(() => this.#syncButtonStates())
  }

  #floatingButton(className, label, icon, onClick) {
    const button = createElement("button", { className, type: "button", "aria-label": label, title: label })
    button.tabIndex = -1
    button.innerHTML = icon
    button.addEventListener("click", onClick)
    return button
  }

  // Update both aria-label (for assistive tech) and title (for tooltips) when
  // a button's label changes between states (collapse/expand, show/hide caption).
  #setButtonLabel(button, label) {
    button.setAttribute("aria-label", label)
    button.setAttribute("title", label)
  }

  get #figure() {
    return this.closest("figure.attachment")
  }

  get #isPreviewAttachment() {
    return this.#figure?.classList.contains("attachment--preview")
  }

  #syncButtonStates() {
    const figure = this.#figure
    if (!figure) return

    if (figure.classList.contains("attachment--collapsed") && this.collapseButton) {
      this.collapseButton.innerHTML = AttachmentIcons.expand
      this.#setButtonLabel(this.collapseButton, "Expand preview")
    }

    if (figure.classList.contains("attachment--caption-hidden")) {
      this.captionButton.innerHTML = AttachmentIcons.captionHide
      this.#setButtonLabel(this.captionButton, "Show caption")
    }
  }

  #triggerNameEdit() {
    const figure = this.#figure
    if (!figure) return

    // Ensure the caption is visible so there's actually something to edit.
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(this)
      if (!$isActionTextAttachmentNode(node) || !node.captionHidden) return

      node.getWritable().captionHidden = false
      this.captionButton.innerHTML = AttachmentIcons.captionShow
      this.#setButtonLabel(this.captionButton, "Hide caption")
    })

    // After the DOM reconciles, focus the appropriate editor:
    //   - .attachment__name (file cards, audio preview, collapsed card view)
    //     → click to open the inline rename input
    //   - figcaption textarea (expanded image-style previews)
    //     → focus + select-all
    requestAnimationFrame(() => {
      const visibleName = this.#visibleElement(figure.querySelectorAll(".attachment__name"))
      if (visibleName) {
        visibleName.click()
        return
      }

      const textarea = this.#visibleElement(figure.querySelectorAll("figcaption textarea"))
      if (textarea) {
        textarea.focus()
        textarea.select()
      }
    })
  }

  #visibleElement(nodeList) {
    for (const el of nodeList) {
      if (el.offsetParent !== null) return el
    }
    return null
  }

  #openPreview() {
    const figure = this.#figure
    if (!figure) return

    // Shared with the figure's dblclick handler in action_text_attachment_node.js
    // so both entry points see the same live DOM state (including the
    // post-swap blob: URL for SVG attachments).
    dispatchAttachmentPreview(figure)
  }

  #toggleCollapse() {
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(this)
      if (!$isActionTextAttachmentNode(node)) return

      const writable = node.getWritable()
      writable.collapsed = !writable.collapsed

      // Mark parent gallery dirty so its transform ejects collapsed nodes
      const parent = writable.getParent()
      if ($isImageGalleryNode(parent)) parent.getWritable()

      const isCollapsed = writable.collapsed
      this.collapseButton.innerHTML = isCollapsed ? AttachmentIcons.expand : AttachmentIcons.collapse
      this.#setButtonLabel(this.collapseButton, isCollapsed ? "Expand preview" : "Collapse preview")
    })

    // Double-RAF: first waits for Lexical's DOM reconciliation to apply
    // the collapsed class, second ensures layout is computed before repositioning
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.#figure?.dispatchEvent(new Event("lexxy:sync-wrapped-block", { bubbles: true }))
      })
    })
  }

  #toggleCaption() {
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(this)
      if (!$isActionTextAttachmentNode(node)) return

      const writable = node.getWritable()
      writable.captionHidden = !writable.captionHidden

      const isHidden = writable.captionHidden
      this.captionButton.innerHTML = isHidden ? AttachmentIcons.captionHide : AttachmentIcons.captionShow
      this.#setButtonLabel(this.captionButton, isHidden ? "Show caption" : "Hide caption")
    })
  }

  #deleteNode() {
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(this)
      node?.remove()
    })
  }
}

export default AttachmentControls
