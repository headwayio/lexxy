import { attachmentIconLabel, createElement } from "../../helpers/html_helper"
import { bytesToHumanSize, extractFileExtension } from "../../helpers/storage_helper"
import AttachmentIcons from "../attachment_icons"

// Shared <dialog>-based preview modal builder used by both the editor-side
// custom element (src/elements/preview_modal.js) and the standalone show-page
// script (src/preview/content_preview.js). Returns { dialog, close } — the
// caller inserts into the DOM and calls dialog.showModal().
//
// The dialog listens for: cancel (Escape key) → close, click-outside → close,
// Space key while focused outside an interactive element → toggle playback.
//
// A download anchor and close button live in the header; the body picks one
// of five content views based on contentType: image, pdf (iframe), video,
// audio, or a generic fallback with a download link.
export function buildPreviewDialog({ src, blobUrl, fileName, contentType, caption, fileSize }) {
  const downloadHref = blobUrl || src

  const box = createElement("div", { className: "lexxy-preview-modal__dialog", tabindex: "-1" })
  box.appendChild(buildHeader({ downloadHref, fileName, caption, fileSize, onClose: close }))
  box.appendChild(buildContent({ src, blobUrl, fileName, contentType, caption }))

  const dialog = createElement("dialog", { className: "lexxy-preview-modal" })
  dialog.appendChild(box)

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault()
    close()
  })

  dialog.addEventListener("click", (event) => {
    if (!box.contains(event.target)) close()
  })

  dialog.addEventListener("keydown", (event) => {
    if (event.key !== " ") return
    const media = dialog.querySelector("video, audio")
    if (!media || document.activeElement?.closest("button, a")) return
    event.preventDefault()
    if (media.paused) media.play(); else media.pause()
  })

  // Close button (inside header) dispatches a custom event we listen for here
  // so the builder owns the close implementation.
  dialog.addEventListener("lexxy:preview-modal-close", close)

  function close() {
    if (dialog.open) dialog.close()
    dialog.remove()
    document.body.classList.remove("lexxy-preview-modal--open")
  }

  return { dialog, box, close }
}

function buildHeader({ downloadHref, fileName, caption, fileSize }) {
  const header = createElement("div", { className: "lexxy-preview-modal__header" })

  const ext = extractFileExtension(fileName)
  const icon = createElement("span", {
    className: `lexxy-preview-modal__icon attachment--${ext}`,
    textContent: attachmentIconLabel(ext)
  })

  const titleInfo = createElement("div", { className: "lexxy-preview-modal__title-info" })
  const formattedSize = fileSize ? bytesToHumanSize(Number(fileSize) || 0) : ""
  const sizeText = formattedSize ? ` · ${formattedSize}` : ""

  if (caption && caption !== fileName) {
    titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__title", textContent: caption }))
    titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__subtitle", textContent: fileName + sizeText }))
  } else {
    titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__title", textContent: fileName || "File" }))
    if (formattedSize) {
      titleInfo.appendChild(createElement("span", { className: "lexxy-preview-modal__subtitle", textContent: formattedSize }))
    }
  }

  const titleGroup = createElement("div", { className: "lexxy-preview-modal__title-group" })
  titleGroup.appendChild(icon)
  titleGroup.appendChild(titleInfo)

  const downloadLink = createElement("a", {
    className: "lexxy-preview-modal__download",
    href: downloadHref,
    download: fileName || ""
  })
  downloadLink.innerHTML = AttachmentIcons.download
  downloadLink.appendChild(document.createTextNode(" Download"))

  const closeButton = createElement("button", {
    className: "lexxy-preview-modal__close",
    type: "button",
    "aria-label": "Close preview"
  })
  closeButton.innerHTML = AttachmentIcons.close
  closeButton.addEventListener("click", () => closeButton.dispatchEvent(new CustomEvent("lexxy:preview-modal-close", { bubbles: true })))

  const actions = createElement("div", { className: "lexxy-preview-modal__actions" })
  actions.appendChild(downloadLink)
  actions.appendChild(closeButton)

  header.appendChild(titleGroup)
  header.appendChild(actions)
  return header
}

function buildContent({ src, blobUrl, fileName, contentType, caption }) {
  const content = createElement("div", { className: "lexxy-preview-modal__content" })
  // For playable media, prefer blobUrl (the actual file) over src (which may
  // be a thumbnail representation URL in the editor). PDFs and images still
  // use src since the editor may embed a preview image directly.
  const mediaSrc = blobUrl || src

  if (isImageType(contentType)) {
    content.appendChild(createElement("img", {
      className: "lexxy-preview-modal__image",
      src,
      alt: fileName || ""
    }))
  } else if (isPdfType(contentType)) {
    content.appendChild(createElement("iframe", {
      className: "lexxy-preview-modal__iframe",
      src: mediaSrc,
      title: "PDF Preview"
    }))
  } else if (isVideoType(contentType)) {
    const video = createElement("video", { className: "lexxy-preview-modal__video", controls: true })
    video.appendChild(createElement("source", { src: mediaSrc, type: contentType }))
    content.appendChild(video)
  } else if (isAudioType(contentType)) {
    const audio = createElement("audio", { className: "lexxy-preview-modal__audio", controls: true })
    audio.appendChild(createElement("source", { src: mediaSrc, type: contentType }))
    content.appendChild(audio)
  } else if (isTextType(contentType, fileName)) {
    content.appendChild(buildTextPreview({ src: mediaSrc, fileName }))
  } else {
    content.appendChild(buildGenericFallback({ src: mediaSrc, fileName, caption }))
  }

  return content
}

function buildTextPreview({ src, fileName }) {
  const pre = createElement("pre", { className: "lexxy-preview-modal__text" })
  pre.textContent = `Loading ${fileName || "text"}…`

  fetch(src)
    .then((response) => response.ok ? response.text() : Promise.reject(response.statusText))
    .then((text) => { pre.textContent = text })
    .catch((error) => { pre.textContent = `Failed to load preview: ${error}` })

  return pre
}

function buildGenericFallback({ src, fileName, caption }) {
  const ext = extractFileExtension(fileName)
  const wrapper = createElement("div", { className: "lexxy-preview-modal__generic" })

  wrapper.appendChild(createElement("span", {
    className: `lexxy-preview-modal__generic-icon attachment--${ext}`,
    textContent: attachmentIconLabel(ext)
  }))

  wrapper.appendChild(createElement("strong", {
    textContent: (caption && caption !== fileName) ? caption : (fileName || "Unknown file")
  }))

  if (caption && caption !== fileName) {
    wrapper.appendChild(createElement("span", { className: "lexxy-preview-modal__generic-hint", textContent: fileName }))
  }

  wrapper.appendChild(createElement("span", {
    className: "lexxy-preview-modal__generic-hint",
    textContent: "No preview available for this file type"
  }))

  wrapper.appendChild(createElement("a", {
    className: "lexxy-preview-modal__generic-download",
    href: src,
    download: fileName || "",
    textContent: "Download"
  }))

  return wrapper
}

function isImageType(contentType) {
  return contentType?.startsWith("image/")
}

function isPdfType(contentType) {
  return contentType === "application/pdf"
}

function isVideoType(contentType) {
  return contentType?.startsWith("video/")
}

function isAudioType(contentType) {
  return contentType?.startsWith("audio/")
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yml", "yaml",
  "log", "ini", "conf", "rb", "js", "ts", "py", "go", "rs", "java",
  "c", "h", "cpp", "css", "scss", "html", "htm", "erb", "sh", "sql"
])

function isTextType(contentType, fileName) {
  if (contentType?.startsWith("text/")) return true
  const ext = extractFileExtension(fileName)
  return ext && TEXT_EXTENSIONS.has(ext)
}
