import Lexxy from "../config/lexxy"
import { $getEditor, $getNearestRootOrShadowRoot, DecoratorNode, HISTORY_MERGE_TAG } from "lexical"
import { createAttachmentFigure, createElement, isPreviewableImage } from "../helpers/html_helper"
import { bytesToHumanSize, extractFileName } from "../helpers/storage_helper"
import { parseBoolean } from "../helpers/string_helper"
import { REWRITE_HISTORY_COMMAND } from "../extensions/rewritable_history_extension"

const INITIAL_PREVIEW_POLL_DELAY_MS = 3000
const MAX_PREVIEW_POLL_DELAY_MS = 120000
const MAX_PREVIEW_POLL_ATTEMPTS = 20

const PREVIEW_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2H5C3.89543 2 3 2.89543 3 4V14C3 15.1046 3.89543 16 5 16H13C14.1046 16 15 15.1046 15 14V7H12C10.8954 7 10 6.10457 10 5V2ZM12 2.41421L14.5858 5H12V2.41421ZM5 1C3.34315 1 2 2.34315 2 4V14C2 15.6569 3.34315 17 5 17H13C14.6569 17 16 15.6569 16 14V6.41421C16 6.01639 15.842 5.63486 15.5607 5.35355L11.6464 1.43934C11.3651 1.15804 10.9836 1 10.5858 1H5Z"/>
</svg>`

const DOWNLOAD_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 1C9.55228 1 10 1.44772 10 2V9.58579L12.2929 7.29289C12.6834 6.90237 13.3166 6.90237 13.7071 7.29289C14.0976 7.68342 14.0976 8.31658 13.7071 8.70711L9.70711 12.7071C9.31658 13.0976 8.68342 13.0976 8.29289 12.7071L4.29289 8.70711C3.90237 8.31658 3.90237 7.68342 4.29289 7.29289C4.68342 6.90237 5.31658 6.90237 5.70711 7.29289L8 9.58579V2C8 1.44772 8.44772 1 9 1ZM3 14C3 13.4477 2.55228 13 2 13C1.44772 13 1 13.4477 1 14V15C1 16.1046 1.89543 17 3 17H15C16.1046 17 17 16.1046 17 15V14C17 13.4477 16.5523 13 16 13C15.4477 13 15 13.4477 15 14V15H3V14Z"/>
</svg>`

export class ActionTextAttachmentNode extends DecoratorNode {
  static getType() {
    return "action_text_attachment"
  }

  static clone(node) {
    return new ActionTextAttachmentNode({ ...node }, node.__key)
  }

  static importJSON(serializedNode) {
    return new ActionTextAttachmentNode({ ...serializedNode })
  }

  static importDOM() {
    return {
      [this.TAG_NAME]: () => {
        return {
          conversion: (attachment) => ({
            node: new ActionTextAttachmentNode({
              sgid: attachment.getAttribute("sgid"),
              src: attachment.getAttribute("url"),
              blobUrl: attachment.getAttribute("blob-url"),
              previewable: attachment.getAttribute("previewable"),
              collapsed: attachment.getAttribute("collapsed"),
              altText: attachment.getAttribute("alt"),
              caption: attachment.getAttribute("caption"),
              contentType: attachment.getAttribute("content-type"),
              fileName: attachment.getAttribute("filename"),
              fileSize: attachment.getAttribute("filesize"),
              width: attachment.getAttribute("width"),
              height: attachment.getAttribute("height")
            })
          }), priority: 1
        }
      },
      "img": () => {
        return {
          conversion: (img) => {
            const fileName = extractFileName(img.getAttribute("src") ?? "")
            return {
              node: new ActionTextAttachmentNode({
                src: img.getAttribute("src"),
                fileName: fileName,
                caption: img.getAttribute("alt") || "",
                contentType: "image/*",
                width: img.getAttribute("width"),
                height: img.getAttribute("height")
              })
            }
          }, priority: 1
        }
      },
      "video": () => {
        return {
          conversion: (video) => {
            const videoSource = video.getAttribute("src") || video.querySelector("source")?.src
            const fileName = videoSource?.split("/")?.pop()
            const contentType = video.querySelector("source")?.getAttribute("content-type") || "video/*"

            return {
              node: new ActionTextAttachmentNode({
                src: videoSource,
                fileName: fileName,
                contentType: contentType
              })
            }
          }, priority: 1
        }
      }
    }
  }

  static get TAG_NAME() {
    return Lexxy.global.get("attachmentTagName")
  }

  constructor({ tagName, sgid, src, blobUrl, previewSrc, previewable, previewStatusUrl, pendingPreview, collapsed, altText, caption, contentType, fileName, fileSize, width, height, uploadError } = {}, key) {
    super(key)

    this.tagName = tagName || ActionTextAttachmentNode.TAG_NAME
    this.sgid = sgid
    this.src = src
    this.blobUrl = blobUrl
    this.previewSrc = previewSrc
    this.previewable = parseBoolean(previewable)
    this.previewStatusUrl = previewStatusUrl
    this.pendingPreview = pendingPreview
    this.collapsed = collapsed != null ? parseBoolean(collapsed) : this.#defaultCollapsed(contentType)
    this.altText = altText || ""
    this.caption = caption || ""
    this.contentType = contentType || ""
    this.fileName = fileName || ""
    this.fileSize = fileSize
    this.width = width
    this.height = height
    this.uploadError = uploadError

    this.editor = $getEditor()
  }

  get fileUrl() {
    return this.blobUrl || this.src
  }

  // PDFs render as the full-width file card by default; the app's read-mode
  // renderer relies on this same default when the attribute is absent.
  static defaultCollapsedFor(contentType) {
    return contentType === "application/pdf"
  }

  #defaultCollapsed(contentType) {
    return ActionTextAttachmentNode.defaultCollapsedFor(contentType)
  }

  createDOM() {
    if (this.uploadError) return this.createDOMForError()
    if (this.pendingPreview) return this.#createDOMForPendingPreview()

    const figure = this.createAttachmentFigure()

    if (this.isPreviewableAttachment) {
      if (this.collapsed) {
        figure.classList.add("attachment--collapsed")
      }

      const previewView = createElement("div", { className: "attachment__preview-view" })
      previewView.appendChild(this.#createDOMForImage())
      previewView.appendChild(this.#createEditableCaption())
      figure.appendChild(previewView)

      const cardView = createElement("div", { className: "attachment__card-view" })
      cardView.appendChild(this.#createDOMForFile())
      cardView.appendChild(this.#createDOMForNotImage())
      figure.appendChild(cardView)
    } else if (this.isVideo) {
      figure.appendChild(this.#createDOMForFile())
      figure.appendChild(this.#createEditableCaption())
    } else {
      figure.appendChild(this.#createDOMForFile())
      figure.appendChild(this.#createDOMForNotImage())
    }

    return figure
  }

  updateDOM(prevNode, dom) {
    if (this.uploadError !== prevNode.uploadError) return true

    const caption = dom.querySelector("figcaption textarea")
    if (caption && this.caption) {
      caption.value = this.caption
    }

    const cardView = dom.querySelector(".attachment__card-view")
    if (cardView) {
      const captionText = cardView.querySelector(".attachment__caption-text")
      if (this.caption) {
        if (captionText) {
          captionText.textContent = this.caption
        } else {
          const meta = cardView.querySelector(".attachment__meta")
          if (meta) {
            const newCaption = createElement("span", { className: "attachment__caption-text", textContent: this.caption })
            meta.prepend(newCaption)
          }
        }
      } else if (captionText) {
        captionText.remove()
      }
    }

    return false
  }

  getTextContent() {
    return `[${this.caption || this.fileName}]\n\n`
  }

  isInline() {
    return this.isAttached() && !this.getParent().is($getNearestRootOrShadowRoot(this))
  }

  exportDOM() {
    const attachment = createElement(this.tagName, {
      sgid: this.sgid,
      previewable: this.previewable || null,
      // Serialize whenever collapsed is on, even at its default: consumers of
      // the saved HTML (the app's read-mode renderer) treat a missing
      // attribute as "not collapsed" and would show a PDF as an inline image.
      collapsed: this.isPreviewableAttachment && (this.collapsed || this.collapsed !== this.#defaultCollapsed(this.contentType)) ? String(this.collapsed) : null,
      url: this.src,
      "blob-url": this.blobUrl || null,
      alt: this.altText,
      caption: this.caption,
      "content-type": this.contentType,
      filename: this.fileName,
      filesize: this.fileSize,
      width: this.width,
      height: this.height,
      presentation: "gallery"
    })

    return { element: attachment }
  }

  exportJSON() {
    return {
      type: "action_text_attachment",
      version: 1,
      tagName: this.tagName,
      sgid: this.sgid,
      src: this.src,
      blobUrl: this.blobUrl,
      previewable: this.previewable,
      previewStatusUrl: this.previewStatusUrl,
      pendingPreview: this.pendingPreview,
      collapsed: this.collapsed,
      altText: this.altText,
      caption: this.caption,
      contentType: this.contentType,
      fileName: this.fileName,
      fileSize: this.fileSize,
      width: this.width,
      height: this.height
    }
  }

  decorate() {
    return null
  }

  createDOMForError() {
    const figure = this.createAttachmentFigure()
    figure.classList.add("attachment--error")
    figure.appendChild(createElement("div", { innerText: `Error uploading ${this.fileName || "file"}` }))
    return figure
  }

  createAttachmentFigure(previewable = this.isPreviewableAttachment) {
    const figure = createAttachmentFigure(this.contentType, previewable, this.fileName)
    figure.draggable = true
    figure.dataset.lexicalNodeKey = this.__key

    const controls = createElement("lexxy-node-delete-button")
    if (this.fileUrl) {
      controls.dataset.fileUrl = this.fileUrl
      controls.dataset.fileName = this.fileName || ""
      controls.dataset.contentType = this.contentType || ""
      controls.dataset.caption = this.caption || ""
    }
    if (this.isPreviewableAttachment) {
      controls.dataset.previewable = "true"
    }
    figure.appendChild(controls)

    return figure
  }

  get isPreviewableAttachment() {
    return this.isPreviewableImage || this.previewable
  }

  get isPreviewableImage() {
    return isPreviewableImage(this.contentType)
  }

  get isVideo() {
    return this.contentType.startsWith("video/")
  }

  #createDOMForPendingPreview() {
    const figure = this.createAttachmentFigure(false)
    figure.appendChild(this.#createDOMForFile())
    figure.appendChild(this.#createDOMForNotImage())
    this.#pollForPreview(figure)
    return figure
  }

  patchAndRewriteHistory(patch) {
    this.editor.dispatchCommand(REWRITE_HISTORY_COMMAND, {
      [this.getKey()]: { patch }
    })
  }

  replaceAndRewriteHistory(node) {
    this.editor.dispatchCommand(REWRITE_HISTORY_COMMAND, {
      [this.getKey()]: { replace: node }
    })
  }

  #createDOMForImage(options = {}) {
    const initialSrc = this.previewSrc || this.src
    const img = createElement("img", { src: initialSrc, draggable: false, alt: this.altText, ...this.#imageDimensions, ...options })

    if (this.previewable && !this.isPreviewableImage) {
      img.onerror = () => this.#swapPreviewToFileDOM(img)
    }

    if (this.previewSrc) {
      this.#preloadAndSwapSrc(img)
    }

    const container = createElement("div", { className: "attachment__container" })
    container.appendChild(img)
    return container
  }

  #preloadAndSwapSrc(img) {
    const previewSrc = this.previewSrc
    const serverImage = new Image()

    serverImage.onload = () => this.#handleImageLoaded(img, previewSrc)
    serverImage.onerror = () => this.#handleImageLoadError(previewSrc)
    serverImage.src = this.src
  }

  #handleImageLoaded(img, previewSrc) {
    img.src = this.src
    this.patchAndRewriteHistory({ previewSrc: null })
    this.#revokePreviewSrc(previewSrc)
  }

  #handleImageLoadError(previewSrc) {
    this.patchAndRewriteHistory({
      previewSrc: null,
      uploadError: true
    })
    this.#revokePreviewSrc(previewSrc)
  }

  #revokePreviewSrc(previewSrc) {
    if (previewSrc?.startsWith("blob:")) URL.revokeObjectURL(previewSrc)
  }

  #swapPreviewToFileDOM(img) {
    const figure = img.closest("figure.attachment")
    if (!figure) return

    this.#swapFigureContent(figure, "attachment--preview", "attachment--file", () => {
      figure.appendChild(this.#createDOMForFile())
      figure.appendChild(this.#createDOMForNotImage())
    })
  }

  // While the file-icon is shown, watch for the preview to become ready.
  // With a status URL, poll it (2xx = processing, anything else = ready).
  // Without one, preload the preview URL once and swap on load.
  #pollForPreview(figure) {
    if (this.previewStatusUrl) {
      this.#waitForPreviewByPollingStatus(figure)
    } else {
      this.#waitForPreviewByPreloadingImage(figure)
    }
  }

  #waitForPreviewByPollingStatus(figure) {
    let attempt = 0

    const tryStatus = async () => {
      if (!this.editor.read(() => this.isAttached())) return

      try {
        // redirect: "manual" prevents fetch from transparently following a
        // 3xx response — without it, a status endpoint that redirected to,
        // say, the preview URL would resolve to a 200 and look like
        // "still processing." The contract is "any non-2xx means done."
        const response = await fetch(this.previewStatusUrl, { credentials: "include", redirect: "manual" })

        if (!this.editor.read(() => this.isAttached())) return

        if (response.ok) {
          retry()
        } else {
          this.#swapToPreviewDOM(figure, this.src)
        }
      } catch {
        retry()
      }
    }

    const retry = () => {
      attempt++
      if (attempt < MAX_PREVIEW_POLL_ATTEMPTS && this.editor.read(() => this.isAttached())) {
        const delay = Math.min(2000 * Math.pow(1.5, attempt), MAX_PREVIEW_POLL_DELAY_MS)
        setTimeout(tryStatus, delay)
      }
    }

    // Give the server time to start processing before the first attempt
    setTimeout(tryStatus, INITIAL_PREVIEW_POLL_DELAY_MS)
  }

  #waitForPreviewByPreloadingImage(figure) {
    const img = new Image()
    img.onload = () => {
      if (!this.editor.read(() => this.isAttached())) return
      this.#swapToPreviewDOM(figure, this.src)
    }
    img.onerror = () => {
      // Clear pendingPreview so undo/redo or any JSON round-trip doesn't
      // re-enter the pending flow and issue another fetch. The file icon
      // stays as the stable fallback.
      if (!this.editor.read(() => this.isAttached())) return
      this.patchAndRewriteHistory({ pendingPreview: false })
    }
    img.src = this.src
  }

  #swapToPreviewDOM(figure, previewSrc) {
    this.#swapFigureContent(figure, "attachment--file", "attachment--preview", () => {
      const img = createElement("img", { src: previewSrc, draggable: false, alt: this.altText })
      img.onerror = () => this.#swapPreviewToFileDOM(img)
      const container = createElement("div", { className: "attachment__container" })
      container.appendChild(img)
      figure.appendChild(container)
      figure.appendChild(this.#createEditableCaption())
    })

    this.patchAndRewriteHistory({ pendingPreview: false })
  }

  #swapFigureContent(figure, fromClass, toClass, renderContent) {
    figure.className = figure.className.replace(fromClass, toClass)

    for (const child of [ ...figure.querySelectorAll(".attachment__container, .attachment__icon, figcaption") ]) {
      child.remove()
    }

    renderContent()
  }

  get #imageDimensions() {
    if (this.width && this.height) {
      return { width: this.width, height: this.height }
    } else {
      return {}
    }
  }

  static FILE_TYPE_LABELS = { md: "M↓", png: "IMG", jpg: "IMG", jpeg: "IMG", gif: "IMG", webp: "IMG", svg: "IMG", xls: "XLS", xlsx: "XLS" }

  #createDOMForFile() {
    const extension = this.fileName ? this.fileName.split(".").pop().toLowerCase() : "?"
    const label = ActionTextAttachmentNode.FILE_TYPE_LABELS[extension] || extension.toUpperCase()
    return createElement("span", { className: "attachment__icon", textContent: label })
  }

  #createDOMForNotImage() {
    const figcaption = createElement("figcaption", { className: "attachment__caption" })

    const nameTag = createElement("strong", { className: "attachment__name", textContent: this.fileName })
    figcaption.appendChild(nameTag)

    const metaRow = createElement("span", { className: "attachment__meta" })

    if (this.caption) {
      const captionTag = createElement("span", { className: "attachment__caption-text", textContent: this.caption })
      metaRow.appendChild(captionTag)
    }

    if (this.fileSize) {
      const subtitle = createElement("span", { className: "attachment__subtitle", textContent: bytesToHumanSize(this.fileSize) })
      metaRow.appendChild(subtitle)
    }

    figcaption.appendChild(metaRow)

    return figcaption
  }

  #createEditableCaption() {
    const caption = createElement("figcaption", { className: "attachment__caption" })
    const input = createElement("textarea", {
      value: this.caption,
      placeholder: this.fileName,
      rows: "1"
    })

    input.addEventListener("focusin", () => input.placeholder = "Add caption...")
    input.addEventListener("blur", (event) => this.#handleCaptionInputBlurred(event))
    input.addEventListener("keydown", (event) => this.#handleCaptionInputKeydown(event))
    input.addEventListener("copy", (event) => event.stopPropagation())
    input.addEventListener("cut", (event) => event.stopPropagation())
    input.addEventListener("paste", (event) => event.stopPropagation())

    caption.appendChild(input)

    return caption
  }

  #handleCaptionInputBlurred(event) {
    this.#updateCaptionValueFromInput(event.target)
  }

  #updateCaptionValueFromInput(input) {
    input.placeholder = this.fileName
    this.editor.update(() => {
      this.getWritable().caption = input.value
    })
  }

  #handleCaptionInputKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      event.target.blur()

      this.editor.update(() => {
        // Place the cursor after the current image
        this.selectNext(0, 0)
      }, {
        tag: HISTORY_MERGE_TAG
      })
    }

    // Stop all keydown events from bubbling to the Lexical root element.
    // The caption textarea is outside Lexical's content model and should
    // handle its own keyboard events natively (Ctrl+A, Ctrl+C, Ctrl+X, etc.).
    event.stopPropagation()
  }
}

export function $createActionTextAttachmentNode(...args) {
  return new ActionTextAttachmentNode(...args)
}

export function $isActionTextAttachmentNode(node) {
  return node instanceof ActionTextAttachmentNode
}
