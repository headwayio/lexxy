import { $getNearestNodeFromDOMNode } from "lexical"
import { createElement, dispatch } from "../helpers/html_helper"
import { $isActionTextAttachmentNode } from "../nodes/action_text_attachment_node"
import { $isImageGalleryNode } from "../nodes/image_gallery_node"
import AttachmentIcons from "./attachment_icons"

export class NodeDeleteButton extends HTMLElement {
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

    container.appendChild(this.#floatingButton("lexxy-node-preview", "Preview", AttachmentIcons.preview, () => this.#openPreview()))

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
    const button = createElement("button", { className, type: "button", "aria-label": label })
    button.tabIndex = -1
    button.innerHTML = icon
    button.addEventListener("click", onClick)
    return button
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
      this.collapseButton.setAttribute("aria-label", "Expand preview")
    }

    if (figure.classList.contains("attachment--caption-hidden")) {
      this.captionButton.innerHTML = AttachmentIcons.captionHide
      this.captionButton.setAttribute("aria-label", "Show caption")
    }
  }

  #triggerNameEdit() {
    const figure = this.#figure
    if (!figure) return

    // For file attachments: click the name to edit inline
    const nameTag = figure.querySelector(".attachment__name")
    if (nameTag && !this.#isPreviewAttachment) {
      nameTag.click()
      return
    }

    // For preview attachments: ensure caption is visible, then focus textarea
    if (this.#isPreviewAttachment) {
      this.editor.update(() => {
        const node = $getNearestNodeFromDOMNode(this)
        if (!$isActionTextAttachmentNode(node)) return

        if (node.captionHidden) {
          const writable = node.getWritable()
          writable.captionHidden = false
          this.captionButton.innerHTML = AttachmentIcons.captionShow
          this.captionButton.setAttribute("aria-label", "Hide caption")
        }
      })

      requestAnimationFrame(() => {
        const textarea = figure.querySelector("figcaption textarea")
        if (textarea) {
          textarea.focus()
          textarea.select()
        }
      })
    }
  }

  #openPreview() {
    const figure = this.#figure
    if (!figure) return

    const nameEl = figure.querySelector(".attachment__name")
    const caption = nameEl?.textContent !== figure.dataset.fileName ? nameEl?.textContent : ""

    dispatch(figure, "lexxy:preview-attachment", {
      src: figure.querySelector("img")?.src || figure.dataset.src,
      blobUrl: figure.dataset.blobUrl,
      fileName: figure.dataset.fileName,
      contentType: figure.dataset.contentType,
      fileSize: figure.dataset.fileSize,
      sgid: figure.dataset.sgid,
      caption
    }, true)
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
      this.collapseButton.setAttribute("aria-label", isCollapsed ? "Expand preview" : "Collapse preview")
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
      this.captionButton.setAttribute("aria-label", isHidden ? "Show caption" : "Hide caption")
    })
  }

  #deleteNode() {
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(this)
      node?.remove()
    })
  }
}

export default NodeDeleteButton
