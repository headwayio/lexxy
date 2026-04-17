import Lexxy from "../config/lexxy"
import { $getEditor, $getNearestRootOrShadowRoot, DecoratorNode, HISTORY_MERGE_TAG, SKIP_DOM_SELECTION_TAG } from "lexical"
import { SILENT_UPDATE_TAGS } from "../helpers/lexical_helper"
import { attachmentIconLabel, createAttachmentFigure, createElement, dispatch, isPreviewableImage } from "../helpers/html_helper"
import { bytesToHumanSize, extractFileExtension, extractFileName, representationToBlobUrl } from "../helpers/storage_helper"
import { parseBoolean } from "../helpers/string_helper"

// Per-src cache of SVG object URLs. ActiveStorage forces image/svg+xml blobs
// to download; we re-fetch once per src, re-MIME as svg+xml, and reuse the
// resulting object URL across every node that points at the same blob.
// Without the cache every createDOM() would leak a new object URL.
const SVG_OBJECT_URL_BY_SRC = new Map()

function cachedSvgObjectUrl(src) {
  const cached = SVG_OBJECT_URL_BY_SRC.get(src)
  if (cached) return cached

  const promise = fetch(src)
    .then(response => response.blob())
    .then(blob => URL.createObjectURL(new Blob([ blob ], { type: "image/svg+xml" })))

  SVG_OBJECT_URL_BY_SRC.set(src, promise)
  return promise
}

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
              altText: attachment.getAttribute("alt"),
              caption: attachment.getAttribute("caption"),
              contentType: attachment.getAttribute("content-type"),
              fileName: attachment.getAttribute("filename"),
              fileSize: attachment.getAttribute("filesize"),
              width: attachment.getAttribute("width"),
              height: attachment.getAttribute("height"),
              collapsed: attachment.getAttribute("data-collapsed"),
              captionHidden: attachment.getAttribute("data-caption-hidden")
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

  constructor({ tagName, sgid, src, blobUrl, previewSrc, previewable, pendingPreview, altText, caption, contentType, fileName, fileSize, width, height, collapsed, captionHidden, uploadError }, key) {
    super(key)

    this.tagName = tagName || ActionTextAttachmentNode.TAG_NAME
    this.sgid = sgid
    this.src = src
    this.blobUrl = blobUrl || null
    this.previewSrc = previewSrc
    this.previewable = parseBoolean(previewable)
    this.pendingPreview = pendingPreview
    this.altText = altText || ""
    this.caption = caption || ""
    this.contentType = contentType || ""
    this.fileName = fileName || ""
    this.fileSize = fileSize
    this.width = width
    this.height = height
    this.collapsed = parseBoolean(collapsed)
    this.captionHidden = parseBoolean(captionHidden)
    this.uploadError = uploadError

    this.editor = $getEditor()
  }

  createDOM() {
    if (this.uploadError) return this.createDOMForError()
    if (this.pendingPreview) return this.#createDOMForPendingPreview()

    const figure = this.createAttachmentFigure()

    if (this.isAudio) {
      const previewView = createElement("div", { className: "attachment__preview-view" })
      previewView.appendChild(this.#createIconLabel())
      previewView.appendChild(this.#createFileCaption())
      previewView.appendChild(this.#createAudioPlayer())
      figure.appendChild(previewView)

      // Audio's card view is identical DOM to the preview-view header (icon + name),
      // so defer creation until it's actually needed (collapsed mode).
      if (this.collapsed) figure.appendChild(this.#createCardView())
    } else if (this.isVideo) {
      const previewView = createElement("div", { className: "attachment__preview-view" })
      previewView.appendChild(this.#createVideoPlayer())
      previewView.appendChild(this.#createEditableCaption())
      figure.appendChild(previewView)

      if (this.collapsed) figure.appendChild(this.#createCardView())
    } else if (this.isPreviewableAttachment) {
      const previewView = createElement("div", { className: "attachment__preview-view" })
      previewView.appendChild(this.#createDOMForImage())
      previewView.appendChild(this.#createEditableCaption())
      figure.appendChild(previewView)

      // Card view is hidden by CSS until the user collapses the attachment.
      // Skip creating it eagerly — significant DOM cost when rendering many
      // attachments at once. updateDOM recreates it when `collapsed` flips.
      if (this.collapsed) figure.appendChild(this.#createCardView())
    } else {
      figure.appendChild(this.#createIconLabel())
      figure.appendChild(this.#createFileCaption())
    }

    if (this.collapsed) figure.classList.add("attachment--collapsed")
    if (this.captionHidden) figure.classList.add("attachment--caption-hidden")

    figure.addEventListener("dblclick", (event) => this.#handlePreviewClick(event))

    return figure
  }

  updateDOM(prevNode, dom) {
    if (this.uploadError !== prevNode.uploadError) return true

    const caption = dom.querySelector("figcaption textarea")
    if (caption && this.caption) {
      caption.value = this.caption
    }

    // Lazy card-view creation: if collapsed flipped on and the card view was
    // never rendered (skipped at createDOM for perf), build it now.
    if (this.collapsed && this.#supportsCardView && !dom.querySelector(".attachment__card-view")) {
      dom.appendChild(this.#createCardView())
    }

    // Sync file/audio attachment name display (non-image attachments).
    // When captionHidden, show original filename; otherwise show caption or filename.
    const displayName = this.captionHidden ? this.fileName : (this.caption || this.fileName)
    for (const nameTag of dom.querySelectorAll(".attachment__name")) {
      if (!nameTag.querySelector("input")) {
        nameTag.textContent = displayName
      }
    }

    dom.classList.toggle("attachment--collapsed", this.collapsed)
    dom.classList.toggle("attachment--caption-hidden", this.captionHidden)

    // Keep the figure's dataset.caption in sync so preview modal can read
    // the authoritative caption regardless of the inline caption-hidden toggle.
    dom.dataset.caption = this.caption || ""

    return false
  }

  get #supportsCardView() {
    return this.isAudio || this.isPreviewableAttachment
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
      url: this.src,
      "blob-url": this.blobUrl || null,
      alt: this.altText,
      caption: this.caption,
      "content-type": this.contentType,
      filename: this.fileName,
      filesize: this.fileSize,
      width: this.width,
      height: this.height,
      presentation: "gallery",
      "data-collapsed": this.collapsed || null,
      "data-caption-hidden": this.captionHidden || null
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
      altText: this.altText,
      caption: this.caption,
      contentType: this.contentType,
      fileName: this.fileName,
      fileSize: this.fileSize,
      width: this.width,
      height: this.height,
      collapsed: this.collapsed,
      captionHidden: this.captionHidden
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
    figure.dataset.src = this.src || ""
    figure.dataset.contentType = this.contentType || ""
    figure.dataset.fileName = this.fileName || ""
    figure.dataset.fileSize = this.fileSize || ""
    figure.dataset.sgid = this.sgid || ""
    figure.dataset.caption = this.caption || ""
    if (this.blobUrl) figure.dataset.blobUrl = this.blobUrl

    const deleteButton = createElement("lexxy-attachment-controls")
    figure.appendChild(deleteButton)

    return figure
  }

  get isPreviewableAttachment() {
    return this.isPreviewableImage || this.previewable || this.isAudio
  }

  get isPreviewableImage() {
    return isPreviewableImage(this.contentType)
  }

  get isAudio() {
    return this.contentType?.startsWith("audio/")
  }

  get isVideo() {
    return this.contentType?.startsWith("video/")
  }

  // For playable media, the stored url/src is often an Active Storage
  // representation URL (a thumbnail image). Derive the actual blob URL so
  // the inline player and modal receive the real file.
  get playbackUrl() {
    return this.blobUrl || representationToBlobUrl(this.src) || this.src
  }

  #createDOMForPendingPreview() {
    const figure = this.createAttachmentFigure(false)
    figure.appendChild(this.#createIconLabel())
    figure.appendChild(this.#createFileCaption())
    this.#pollForPreview(figure)
    return figure
  }

  #createDOMForImage(options = {}) {
    const initialSrc = this.previewSrc || this.src
    const img = createElement("img", { src: initialSrc, draggable: false, alt: this.altText, ...this.#imageDimensions, ...options })

    if (this.previewable && !this.isPreviewableImage) {
      img.onerror = () => this.#swapPreviewToFileDOM(img)
    }

    // ActiveStorage forces image/svg+xml downloads (security default — SVGs
    // can embed <script>). Re-fetch and serve via an object URL with the
    // correct MIME so <img> can render it. Object URLs sidestep the original
    // Content-Disposition; <img> can't execute scripts from inline SVG either way.
    // Cached per src so repeated renders (and sibling nodes at the same URL)
    // share one fetch + one object URL instead of leaking one per createDOM().
    if (this.contentType === "image/svg+xml") {
      cachedSvgObjectUrl(this.src)
        .then(objectUrl => { if (img.isConnected) img.src = objectUrl })
        .catch(() => this.#swapPreviewToFileDOM(img))
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
    this.editor.update(() => {
      if (this.isAttached()) this.getWritable().previewSrc = null
    }, { tag: this.backgroundUpdateTags })
    this.#revokePreviewSrc(previewSrc)
  }

  #handleImageLoadError(previewSrc) {
    this.editor.update(() => {
      if (this.isAttached()) {
        this.getWritable().previewSrc = null
        this.getWritable().uploadError = true
      }
    }, { tag: this.backgroundUpdateTags })
    this.#revokePreviewSrc(previewSrc)
  }

  // Lifecycle methods (preview swap, upload progress/completion) run async
  // and may fire while the user is focused on another element (e.g., a title
  // field). Without SKIP_DOM_SELECTION_TAG, Lexical's reconciler would move
  // the DOM selection back into the editor, stealing focus.
  get backgroundUpdateTags() {
    const rootElement = this.editor.getRootElement()
    const editorHasFocus = rootElement !== null && rootElement.contains(document.activeElement)

    if (editorHasFocus) {
      return SILENT_UPDATE_TAGS
    } else {
      return [ ...SILENT_UPDATE_TAGS, SKIP_DOM_SELECTION_TAG ]
    }
  }

  #revokePreviewSrc(previewSrc) {
    if (previewSrc?.startsWith("blob:")) URL.revokeObjectURL(previewSrc)
  }

  #swapPreviewToFileDOM(img) {
    const figure = img.closest("figure.attachment")
    if (!figure) return

    this.#swapFigureContent(figure, "attachment--preview", "attachment--file", () => {
      figure.appendChild(this.#createIconLabel())
      figure.appendChild(this.#createFileCaption())
    })
  }

  #pollForPreview(figure) {
    let attempt = 0
    const maxAttempts = 10

    const tryLoad = () => {
      if (!this.editor.read(() => this.isAttached())) return

      const img = new Image()

      img.onload = () => {
        if (!this.editor.read(() => this.isAttached())) return

        // The placeholder is a file-type icon SVG (86×100). A real thumbnail
        // generated from PDF/video content is significantly larger.
        if (img.naturalWidth > 150 && img.naturalHeight > 150) {
          this.#swapToPreviewDOM(figure, this.src)
        } else {
          retry()
        }
      }
      img.onerror = () => retry()
      img.src = this.src
    }

    const retry = () => {
      attempt++
      if (attempt < maxAttempts && this.editor.read(() => this.isAttached())) {
        const delay = Math.min(2000 * Math.pow(1.5, attempt), 15000)
        setTimeout(tryLoad, delay)
      }
    }

    // Give the server time to start processing before the first attempt
    setTimeout(tryLoad, 3000)
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

    this.editor.update(() => {
      if (this.isAttached()) this.getWritable().pendingPreview = false
    }, { tag: this.backgroundUpdateTags })
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

  #createCardView() {
    const cardView = createElement("div", { className: "attachment__card-view" })
    const caption = createElement("figcaption", { className: "attachment__caption" })
    caption.appendChild(this.#createNameTag())
    if (this.fileSize) {
      caption.appendChild(createElement("span", { className: "attachment__subtitle", textContent: bytesToHumanSize(this.fileSize) }))
    }
    cardView.appendChild(this.#createIconLabel())
    cardView.appendChild(caption)
    return cardView
  }

  #createAudioPlayer() {
    const audio = createElement("audio", { controls: true, preload: "metadata" })
    audio.appendChild(createElement("source", { src: this.playbackUrl, type: this.contentType }))
    return audio
  }

  #createVideoPlayer() {
    const video = createElement("video", { controls: true, preload: "metadata", className: "attachment__video" })
    video.appendChild(createElement("source", { src: this.playbackUrl, type: this.contentType }))
    return video
  }

  // <figcaption> with the rename-able name + size, used by file attachments
  // (xls/csv/etc.) and by the audio preview's file-info row. The collapsed
  // card view uses a similar but distinct layout (icon + name + subtitle
  // wrapped in a .attachment__card-view div) — see #createCardView.
  #createFileCaption() {
    const figcaption = createElement("figcaption", { className: "attachment__caption" })
    figcaption.appendChild(this.#createNameTag())
    if (this.fileSize) {
      figcaption.appendChild(createElement("span", { className: "attachment__size", textContent: bytesToHumanSize(this.fileSize) }))
    }
    return figcaption
  }

  #createIconLabel() {
    return createElement("span", { className: "attachment__icon", textContent: attachmentIconLabel(this.#fileExtension) })
  }

  // Renders the display name (caption or filename) with click-to-rename
  // behaviour wired in. Used by every attachment layout — file card, audio
  // preview, collapsed card view — so the rename UX is consistent everywhere.
  #createNameTag() {
    const nameTag = createElement("strong", {
      className: "attachment__name",
      textContent: this.#displayName,
      title: "Click to rename"
    })
    nameTag.addEventListener("click", (event) => this.#startEditingName(event, nameTag))
    return nameTag
  }

  get #fileExtension() {
    return extractFileExtension(this.fileName) || "unknown"
  }

  get #displayName() {
    return this.captionHidden ? this.fileName : (this.caption || this.fileName)
  }

  #startEditingName(event, nameTag) {
    event.stopPropagation()

    // Don't create another input if already editing
    if (nameTag.querySelector("input")) return

    // Read the currently displayed text (not the stored node caption, which
    // may be stale if the user edited but hasn't submitted yet)
    const currentName = nameTag.textContent.trim() || this.fileName
    let escaped = false

    const input = createElement("input", {
      type: "text",
      className: "attachment__name-input",
      value: currentName
    })

    input.addEventListener("blur", () => {
      if (escaped) {
        this.#clearCustomName(nameTag)
      } else {
        this.#finishEditingName(input, nameTag)
      }
    })

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        input.blur()
      } else if (event.key === "Escape") {
        event.preventDefault()
        escaped = true
        input.blur()
      }
      event.stopPropagation()
    })

    // Prevent editor from handling these
    input.addEventListener("copy", (event) => event.stopPropagation())
    input.addEventListener("cut", (event) => event.stopPropagation())
    input.addEventListener("paste", (event) => event.stopPropagation())
    input.addEventListener("dblclick", (event) => event.stopPropagation())
    input.addEventListener("click", (event) => event.stopPropagation())

    nameTag.textContent = ""
    nameTag.appendChild(input)

    // Defer focus+select to the next microtask so the originating click
    // event doesn't immediately deselect the text
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  }

  #finishEditingName(input, nameTag) {
    const newName = input.value.trim()
    const hasCustomName = newName && newName !== this.fileName

    nameTag.textContent = hasCustomName ? newName : this.fileName

    this.editor.update(() => {
      const writable = this.getWritable()
      writable.caption = hasCustomName ? newName : ""
      if (hasCustomName) writable.captionHidden = false
    })
  }

  #clearCustomName(nameTag) {
    nameTag.textContent = this.fileName

    this.editor.update(() => {
      const writable = this.getWritable()
      writable.caption = ""
      writable.captionHidden = true
    })
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

  #handlePreviewClick(event) {
    if (event.target.closest("textarea, lexxy-attachment-controls, button")) return

    dispatch(event.currentTarget, "lexxy:preview-attachment", {
      src: this.src,
      blobUrl: this.playbackUrl,
      fileName: this.fileName,
      contentType: this.contentType,
      fileSize: this.fileSize,
      sgid: this.sgid
    }, true)
  }
}

export function $createActionTextAttachmentNode(...args) {
  return new ActionTextAttachmentNode(...args)
}

export function $isActionTextAttachmentNode(node) {
  return node instanceof ActionTextAttachmentNode
}
