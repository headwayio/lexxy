import Lexxy from "../config/lexxy"
import { attachmentIconLabel, createElement } from "../helpers/html_helper"
import { bytesToHumanSize } from "../helpers/storage_helper"

const CLOSE_ICON = "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 6L6 18M6 6l12 12\"/></svg>"

const DOWNLOAD_ICON = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg>"

const PDF_TYPES = [ "application/pdf" ]
const VIDEO_TYPES = [ "video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/*" ]
const AUDIO_TYPES = [ "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/*" ]

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
  #caption = null
  #fileSize = null

  connectedCallback() {
    if (!Lexxy.global.get("previewModal")) return

    this.handlePreviewEvent = (event) => this.#onPreviewRequest(event)
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

    const { src, blobUrl, fileName, contentType, fileSize, sgid, caption } = event.detail
    if (!src && !blobUrl) return

    this.#open(src, blobUrl, fileName, contentType, fileSize, sgid, caption)
  }

  #open(src, blobUrl, fileName, contentType, fileSize, sgid, caption) {
    this.#close()

    const downloadSrc = blobUrl || src
    this.#caption = caption
    this.#fileSize = fileSize

    // Use <dialog> for native Escape handling — the cancel event fires
    // even when focus is inside native video/audio controls.
    this.dialog = document.createElement("dialog")
    this.dialog.className = "lexxy-preview-modal"

    this.dialogBox = createElement("div", {
      className: "lexxy-preview-modal__dialog",
      tabIndex: -1,
      autofocus: true
    })
    this.dialogBox.appendChild(this.#buildHeader(downloadSrc, fileName, contentType))
    this.dialogBox.appendChild(this.#buildContent(src, blobUrl, fileName, contentType))
    this.dialog.appendChild(this.dialogBox)

    // Cancel event fires on Escape even from native video controls
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault()
      this.#pauseMedia()
      this.#close()
    })

    // Backdrop click: click on dialog element (not content box) closes modal.
    // On desktop the content box is inset, leaving visible backdrop area.
    this.dialog.addEventListener("click", (event) => {
      if (!this.dialogBox.contains(event.target)) this.#close()
    })

    // Space toggles play/pause on video/audio (skip if focused on a control)
    this.dialog.addEventListener("keydown", (event) => {
      if (event.key !== " ") return
      const media = this.dialog.querySelector("video, audio")
      if (!media) return
      if (document.activeElement?.closest("button, a, select, input, textarea")) return
      event.preventDefault()
      if (media.paused) media.play()
      else media.pause()
    })

    document.body.appendChild(this.dialog)
    this.dialog.showModal()
    // Focus the content box (not a button) so Space immediately toggles
    // play/pause without needing to tab to the video controls first.
    this.dialogBox.focus()
    document.body.classList.add("lexxy-preview-modal--open")
  }

  #pauseMedia() {
    const media = this.dialog?.querySelector("video, audio")
    if (media && !media.paused) media.pause()
  }

  #close() {
    document.body.classList.remove("lexxy-preview-modal--open")
    if (this.dialog?.open) this.dialog.close()
    this.dialog?.remove()
    this.dialog = null
    this.dialogBox = null
  }

  #buildHeader(src, fileName, contentType) {
    const header = createElement("div", { className: "lexxy-preview-modal__header" })

    const ext = fileExtension(fileName)
    const icon = createElement("span", {
      className: `lexxy-preview-modal__icon attachment--${ext}`,
      textContent: attachmentIconLabel(ext)
    })

    const titleGroup = createElement("div", { className: "lexxy-preview-modal__title-group" })
    titleGroup.appendChild(icon)

    const titleInfo = createElement("div", { className: "lexxy-preview-modal__title-info" })
    const formattedSize = this.#fileSize ? bytesToHumanSize(Number(this.#fileSize) || 0) : ""
    const sizeText = formattedSize ? " · " + formattedSize : ""

    if (this.#caption && this.#caption !== fileName) {
      titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__title", textContent: this.#caption }))
      titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__subtitle", textContent: fileName + sizeText }))
    } else {
      titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__title", textContent: fileName || "File" }))
      if (formattedSize) {
        titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__subtitle", textContent: formattedSize }))
      }
    }

    titleGroup.appendChild(titleInfo)

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
      textContent: attachmentIconLabel(ext)
    })

    const name = createElement("strong", {
      textContent: (this.#caption && this.#caption !== fileName) ? this.#caption : (fileName || "Unknown file")
    })

    if (this.#caption && this.#caption !== fileName) {
      const subName = createElement("span", {
        className: "lexxy-preview-modal__generic-hint",
        textContent: fileName
      })
      wrapper.appendChild(icon)
      wrapper.appendChild(name)
      wrapper.appendChild(subName)
    } else {
      wrapper.appendChild(icon)
      wrapper.appendChild(name)
    }
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

    wrapper.appendChild(hint)
    wrapper.appendChild(download)

    return wrapper
  }
}

export default PreviewModal
