import Lexxy from "../config/lexxy"
import { $getEditor, $getNearestRootOrShadowRoot, DecoratorNode, HISTORY_MERGE_TAG } from "lexical"
import { createAttachmentFigure, createElement, isPreviewableImage } from "../helpers/html_helper"
import { bytesToHumanSize, extractFileName } from "../helpers/storage_helper"
import { parseBoolean } from "../helpers/string_helper"


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

  constructor({ tagName, sgid, src, blobUrl, previewable, collapsed, altText, caption, contentType, fileName, fileSize, width, height }, key) {
    super(key)

    this.tagName = tagName || ActionTextAttachmentNode.TAG_NAME
    this.sgid = sgid
    this.src = src
    this.blobUrl = blobUrl
    this.previewable = parseBoolean(previewable)
    this.collapsed = collapsed != null ? parseBoolean(collapsed) : this.#defaultCollapsed(contentType)
    this.altText = altText || ""
    this.caption = caption || ""
    this.contentType = contentType || ""
    this.fileName = fileName || ""
    this.fileSize = fileSize
    this.width = width
    this.height = height

    this.editor = $getEditor()
  }

  get fileUrl() {
    return this.blobUrl || this.src
  }

  #defaultCollapsed(contentType) {
    return contentType === "application/pdf"
  }

  createDOM() {
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
    } else {
      figure.appendChild(this.#createDOMForFile())
      figure.appendChild(this.#createDOMForNotImage())
    }

    return figure
  }

  updateDOM(_prevNode, dom) {
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
      collapsed: this.collapsed ? "true" : null,
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

  #createDOMForImage(options = {}) {
    const img = createElement("img", { src: this.src, draggable: false, alt: this.altText, ...this.#imageDimensions, ...options })

    if (this.previewable && !this.isPreviewableImage) {
      img.onerror = () => this.#swapPreviewToFileDOM(img)
    }

    const container = createElement("div", { className: "attachment__container" })
    container.appendChild(img)
    return container
  }

  #swapPreviewToFileDOM(img) {
    const figure = img.closest("figure.attachment")
    if (!figure) return

    figure.className = figure.className.replace("attachment--preview", "attachment--file")

    const container = figure.querySelector(".attachment__container")
    if (container) container.remove()

    const caption = figure.querySelector("figcaption")
    if (caption) caption.remove()

    figure.appendChild(this.#createDOMForFile())
    figure.appendChild(this.#createDOMForNotImage())
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
