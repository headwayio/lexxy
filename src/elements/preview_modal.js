import Lexxy from "../config/lexxy"
import { createElement } from "../helpers/html_helper"
import { bytesToHumanSize } from "../helpers/storage_helper"

const CLOSE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`

const DOWNLOAD_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

const PDF_TYPES = ["application/pdf"]
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/*"]
const AUDIO_TYPES = ["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/*"]

function isImageType(contentType) {
  return contentType?.startsWith("image/")
}

function isPdfType(contentType) {
  return PDF_TYPES.includes(contentType)
}

function isVideoType(contentType) {
  return contentType?.startsWith("video/") || VIDEO_TYPES.includes(contentType)
}

function isAudioType(contentType) {
  return contentType?.startsWith("audio/") || AUDIO_TYPES.includes(contentType)
}

function fileExtension(fileName) {
  return fileName ? fileName.split(".").pop().toLowerCase() : ""
}

export class PreviewModal extends HTMLElement {
  connectedCallback() {
    if (!Lexxy.global.get("previewModal")) return

    this.handlePreviewEvent = (event) => this.#onPreviewRequest(event)
    this.handleKeydown = (event) => { if (event.key === "Escape") this.#close() }

    document.addEventListener("lexxy:preview-attachment", this.handlePreviewEvent)
  }

  disconnectedCallback() {
    if (this.handlePreviewEvent) {
      document.removeEventListener("lexxy:preview-attachment", this.handlePreviewEvent)
    }
    this.#close()
  }

  #onPreviewRequest(event) {
    if (event.defaultPrevented) return

    const { src, blobUrl, fileName, contentType, fileSize, sgid } = event.detail
    if (!src && !blobUrl) return

    this.#open(src, blobUrl, fileName, contentType, fileSize, sgid)
  }

  #open(src, blobUrl, fileName, contentType, fileSize, sgid) {
    this.#close()

    const downloadSrc = blobUrl || src

    this.backdrop = createElement("div", { className: "lexxy-preview-modal__backdrop" })
    this.dialog = createElement("div", { className: "lexxy-preview-modal__dialog" })

    this.dialog.appendChild(this.#buildHeader(downloadSrc, fileName, contentType))
    this.dialog.appendChild(this.#buildContent(src, blobUrl, fileName, contentType))

    this.backdrop.addEventListener("click", (e) => { if (e.target === this.backdrop) this.#close() })
    document.addEventListener("keydown", this.handleKeydown)

    document.body.appendChild(this.backdrop)
    document.body.appendChild(this.dialog)
    document.body.classList.add("lexxy-preview-modal--open")
  }

  #close() {
    document.removeEventListener("keydown", this.handleKeydown)
    document.body.classList.remove("lexxy-preview-modal--open")
    this.backdrop?.remove()
    this.dialog?.remove()
    this.backdrop = null
    this.dialog = null
  }

  #buildHeader(src, fileName, contentType) {
    const header = createElement("div", { className: "lexxy-preview-modal__header" })

    const ext = fileExtension(fileName)
    const icon = createElement("span", {
      className: `lexxy-preview-modal__icon attachment--${ext}`,
      textContent: ext.toUpperCase()
    })

    const title = createElement("span", { className: "lexxy-preview-modal__title", textContent: fileName || "File" })

    const titleGroup = createElement("div", { className: "lexxy-preview-modal__title-group" })
    titleGroup.appendChild(icon)
    titleGroup.appendChild(title)

    const actions = createElement("div", { className: "lexxy-preview-modal__actions" })

    const downloadLink = createElement("a", {
      className: "lexxy-preview-modal__download",
      href: src,
      download: fileName || true
    })
    downloadLink.innerHTML = DOWNLOAD_ICON
    downloadLink.appendChild(document.createTextNode(" Download"))

    const closeButton = createElement("button", {
      className: "lexxy-preview-modal__close",
      type: "button",
      "aria-label": "Close preview"
    })
    closeButton.innerHTML = CLOSE_ICON
    closeButton.addEventListener("click", () => this.#close())

    actions.appendChild(downloadLink)
    actions.appendChild(closeButton)

    header.appendChild(titleGroup)
    header.appendChild(actions)

    return header
  }

  #buildContent(src, blobUrl, fileName, contentType) {
    const content = createElement("div", { className: "lexxy-preview-modal__content" })
    const fileSrc = blobUrl || src

    if (isImageType(contentType)) {
      content.appendChild(this.#renderImage(src, fileName))
    } else if (isPdfType(contentType)) {
      content.appendChild(this.#renderPdf(fileSrc))
    } else if (isVideoType(contentType)) {
      content.appendChild(this.#renderVideo(fileSrc, contentType))
    } else if (isAudioType(contentType)) {
      content.appendChild(this.#renderAudio(fileSrc, contentType))
    } else {
      content.appendChild(this.#renderGeneric(fileSrc, fileName, contentType))
    }

    return content
  }

  #renderImage(src, fileName) {
    return createElement("img", {
      className: "lexxy-preview-modal__image",
      src,
      alt: fileName || ""
    })
  }

  #renderPdf(src) {
    const url = src.replace(/[?&]disposition=attachment/, "")
    return createElement("iframe", {
      className: "lexxy-preview-modal__iframe",
      src: url,
      title: "PDF Preview"
    })
  }

  #renderVideo(src, contentType) {
    const video = createElement("video", {
      className: "lexxy-preview-modal__video",
      controls: true
    })
    const source = createElement("source", { src, type: contentType === "video/*" ? "" : contentType })
    video.appendChild(source)
    return video
  }

  #renderAudio(src, contentType) {
    const audio = createElement("audio", {
      className: "lexxy-preview-modal__audio",
      controls: true
    })
    const source = createElement("source", { src, type: contentType === "audio/*" ? "" : contentType })
    audio.appendChild(source)
    return audio
  }

  #renderGeneric(src, fileName, contentType) {
    const ext = fileExtension(fileName)
    const wrapper = createElement("div", { className: "lexxy-preview-modal__generic" })

    const icon = createElement("span", {
      className: `lexxy-preview-modal__generic-icon attachment--${ext}`,
      textContent: ext.toUpperCase()
    })

    const name = createElement("strong", { textContent: fileName || "Unknown file" })
    const hint = createElement("span", {
      className: "lexxy-preview-modal__generic-hint",
      textContent: "No preview available for this file type"
    })

    const download = createElement("a", {
      className: "lexxy-preview-modal__generic-download",
      href: src,
      download: fileName || true,
      textContent: "Download"
    })

    wrapper.appendChild(icon)
    wrapper.appendChild(name)
    wrapper.appendChild(hint)
    wrapper.appendChild(download)

    return wrapper
  }
}

export default PreviewModal
