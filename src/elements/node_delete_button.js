import { $getNearestNodeFromDOMNode } from "lexical"
import { createElement, dispatch } from "../helpers/html_helper"
import { $isActionTextAttachmentNode } from "../nodes/action_text_attachment_node"
import { $isImageGalleryNode } from "../nodes/image_gallery_node"

const PREVIEW_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 4C5.13 4 1.86 6.42 0.5 9.5C1.86 12.58 5.13 15 9 15C12.87 15 16.14 12.58 17.5 9.5C16.14 6.42 12.87 4 9 4ZM9 13C6.79 13 5 11.21 5 9C5 6.79 6.79 5 9 5C11.21 5 13 6.79 13 9C13 11.21 11.21 13 9 13ZM9 6.5C7.62 6.5 6.5 7.62 6.5 9C6.5 10.38 7.62 11.5 9 11.5C10.38 11.5 11.5 10.38 11.5 9C11.5 7.62 10.38 6.5 9 6.5Z"/>
</svg>`

const COLLAPSE_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 6.5L4 11.5L5.4 13L9 9.5L12.6 13L14 11.5L9 6.5Z"/>
</svg>`

const EXPAND_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 12.5L14 7.5L12.6 6L9 9.5L5.4 6L4 7.5L9 12.5Z"/>
</svg>`

const CAPTION_SHOW_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 4h14v2H2V4zm0 4h10v2H2V8zm0 4h12v2H2v-2z"/>
</svg>`

const CAPTION_HIDE_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 4h14v2H2V4zm0 4h10v2H2V8zm0 4h12v2H2v-2z" opacity="0.3"/>
  <path d="M1 1l16 16" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`

const EDIT_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M13.293 1.293a1 1 0 011.414 0l2 2a1 1 0 010 1.414l-9 9A1 1 0 017 14H5a1 1 0 01-1-1v-2a1 1 0 01.293-.707l9-9zM6 12.586V13h.414l8.293-8.293-.414-.414L6 12.586z"/>
</svg>`

const DELETE_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M11.2041 1.01074C12.2128 1.113 13 1.96435 13 3V4H15L15.1025 4.00488C15.6067 4.05621 16 4.48232 16 5C16 5.55228 15.5523 6 15 6H14.8457L14.1416 15.1533C14.0614 16.1953 13.1925 17 12.1475 17H5.85254L5.6582 16.9902C4.76514 16.9041 4.03607 16.2296 3.88184 15.3457L3.8584 15.1533L3.1543 6H3C2.44772 6 2 5.55228 2 5C2 4.44772 2.44772 4 3 4H5V3C5 1.89543 5.89543 1 7 1H11L11.2041 1.01074ZM5.85254 15H12.1475L12.8398 6H5.16016L5.85254 15ZM7 4H11V3H7V4Z"/>
</svg>`

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

    // Preview (eye) button
    const previewButton = createElement("button", {
      className: "lexxy-node-preview",
      type: "button",
      "aria-label": "Preview"
    })
    previewButton.tabIndex = -1
    previewButton.innerHTML = PREVIEW_ICON
    previewButton.addEventListener("click", () => this.#openPreview())
    container.appendChild(previewButton)

    // Collapse/expand toggle for image previews
    if (this.#isPreviewAttachment) {
      this.collapseButton = createElement("button", {
        className: "lexxy-node-collapse",
        type: "button",
        "aria-label": "Collapse preview"
      })
      this.collapseButton.tabIndex = -1
      this.collapseButton.innerHTML = COLLAPSE_ICON
      this.collapseButton.addEventListener("click", () => this.#toggleCollapse())
      container.appendChild(this.collapseButton)
    }

    // Edit name (pencil) button
    const editButton = createElement("button", {
      className: "lexxy-node-edit",
      type: "button",
      "aria-label": "Edit name"
    })
    editButton.tabIndex = -1
    editButton.innerHTML = EDIT_ICON
    editButton.addEventListener("click", () => this.#triggerNameEdit())
    container.appendChild(editButton)

    // Caption show/hide toggle
    this.captionButton = createElement("button", {
      className: "lexxy-node-caption-toggle",
      type: "button",
      "aria-label": "Hide caption"
    })
    this.captionButton.tabIndex = -1
    this.captionButton.innerHTML = CAPTION_SHOW_ICON
    this.captionButton.addEventListener("click", () => this.#toggleCaption())
    container.appendChild(this.captionButton)

    // Delete button
    const deleteButton = createElement("button", {
      className: "lexxy-node-delete",
      type: "button",
      "aria-label": "Remove"
    })
    deleteButton.tabIndex = -1
    deleteButton.innerHTML = DELETE_ICON
    deleteButton.addEventListener("click", () => this.#deleteNode())
    container.appendChild(deleteButton)

    this.appendChild(container)

    // Sync initial button state (collapsed/caption-hidden) from the Lexical node.
    // Deferred to next frame because the Lexical node may not be registered yet
    // when connectedCallback fires during DOM construction.
    requestAnimationFrame(() => this.#syncButtonStates())
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
      this.collapseButton.innerHTML = EXPAND_ICON
      this.collapseButton.setAttribute("aria-label", "Expand preview")
    }

    if (figure.classList.contains("attachment--caption-hidden")) {
      this.captionButton.innerHTML = CAPTION_HIDE_ICON
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
          this.captionButton.innerHTML = CAPTION_SHOW_ICON
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
      this.collapseButton.innerHTML = isCollapsed ? EXPAND_ICON : COLLAPSE_ICON
      this.collapseButton.setAttribute("aria-label", isCollapsed ? "Expand preview" : "Collapse preview")
    })

    this.#figure?.dispatchEvent(new Event("lexxy:sync-wrapped-block", { bubbles: true }))
  }

  #toggleCaption() {
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(this)
      if (!$isActionTextAttachmentNode(node)) return

      const writable = node.getWritable()
      writable.captionHidden = !writable.captionHidden

      const isHidden = writable.captionHidden
      this.captionButton.innerHTML = isHidden ? CAPTION_HIDE_ICON : CAPTION_SHOW_ICON
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
