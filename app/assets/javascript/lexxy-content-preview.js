// Standalone preview modal for rendered ActionText content.
// Include this script on pages that display rich text to enable
// the preview (eye) button on attachments.

const CLOSE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
const DOWNLOAD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'

function fileExtension(fileName) {
  return fileName ? fileName.split(".").pop().toLowerCase() : ""
}

// Keep in sync with ICON_LABELS in src/helpers/html_helper.js and the
// matching Ruby map in the blob partial. This file is a standalone
// show-page script so it can't import from src/.
const ICON_LABELS = {
  md: "M\u2193", markdown: "M\u2193",
  png: "IMG", jpg: "IMG", jpeg: "IMG", webp: "IMG", svg: "IMG",
  bmp: "IMG", tiff: "IMG", tif: "IMG", ico: "IMG", avif: "IMG", heic: "IMG",
  docx: "DOC", xlsx: "XLS", pptx: "PPT",
  rar: "ZIP", webm: "VID", avi: "VID"
}

function iconLabel(ext) {
  if (!ext) return ""
  return ICON_LABELS[ext] || ext.toUpperCase()
}

// Port of bytesToHumanSize in src/helpers/storage_helper.js. Kept in sync so
// the editor preview modal and the show-page preview modal print identical
// file sizes for the same blob.
function formatFileSize(bytes) {
  if (!bytes) return ""
  bytes = Number(bytes)
  if (bytes === 0) return "0 B"
  const sizes = [ "B", "KB", "MB", "GB", "TB", "PB" ]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${ (bytes / Math.pow(1024, i)).toFixed(2) } ${ sizes[i] }`
}

function openPreviewModal(src, fileName, contentType, caption, fileSize) {
  closePreviewModal()

  const dialog = document.createElement("dialog")
  dialog.className = "lexxy-preview-modal"
  dialog.id = "lexxy-content-preview"

  const box = document.createElement("div")
  box.className = "lexxy-preview-modal__dialog"
  box.tabIndex = -1

  // Header
  const header = document.createElement("div")
  header.className = "lexxy-preview-modal__header"

  const ext = fileExtension(fileName)
  const titleGroup = document.createElement("div")
  titleGroup.className = "lexxy-preview-modal__title-group"

  const icon = document.createElement("span")
  icon.className = `lexxy-preview-modal__icon attachment--${ext}`
  icon.textContent = iconLabel(ext)
  titleGroup.appendChild(icon)

  const titleInfo = document.createElement("div")
  titleInfo.className = "lexxy-preview-modal__title-info"

  if (caption && caption !== fileName) {
    const captionEl = document.createElement("span")
    captionEl.className = "lexxy-preview-modal__title"
    captionEl.textContent = caption
    titleInfo.appendChild(captionEl)

    const subtitleEl = document.createElement("span")
    subtitleEl.className = "lexxy-preview-modal__subtitle"
    subtitleEl.textContent = fileName + (fileSize ? " · " + formatFileSize(fileSize) : "")
    titleInfo.appendChild(subtitleEl)
  } else {
    const title = document.createElement("span")
    title.className = "lexxy-preview-modal__title"
    title.textContent = fileName || "File"
    titleInfo.appendChild(title)

    if (fileSize) {
      const sizeEl = document.createElement("span")
      sizeEl.className = "lexxy-preview-modal__subtitle"
      sizeEl.textContent = formatFileSize(fileSize)
      titleInfo.appendChild(sizeEl)
    }
  }

  titleGroup.appendChild(titleInfo)

  const actions = document.createElement("div")
  actions.className = "lexxy-preview-modal__actions"

  const downloadLink = document.createElement("a")
  downloadLink.className = "lexxy-preview-modal__download"
  downloadLink.href = src
  downloadLink.download = fileName || ""
  downloadLink.innerHTML = DOWNLOAD_ICON + " Download"

  const closeButton = document.createElement("button")
  closeButton.className = "lexxy-preview-modal__close"
  closeButton.type = "button"
  closeButton.ariaLabel = "Close preview"
  closeButton.innerHTML = CLOSE_ICON
  closeButton.addEventListener("click", closePreviewModal)

  actions.appendChild(downloadLink)
  actions.appendChild(closeButton)
  header.appendChild(titleGroup)
  header.appendChild(actions)

  // Content
  const content = document.createElement("div")
  content.className = "lexxy-preview-modal__content"

  if (contentType?.startsWith("image/")) {
    const img = document.createElement("img")
    img.className = "lexxy-preview-modal__image"
    img.src = src
    img.alt = fileName || ""
    content.appendChild(img)
  } else if (contentType === "application/pdf") {
    const iframe = document.createElement("iframe")
    iframe.className = "lexxy-preview-modal__iframe"
    iframe.src = src
    iframe.title = "PDF Preview"
    content.appendChild(iframe)
  } else if (contentType?.startsWith("video/")) {
    const video = document.createElement("video")
    video.className = "lexxy-preview-modal__video"
    video.controls = true
    const source = document.createElement("source")
    source.src = src
    source.type = contentType
    video.appendChild(source)
    content.appendChild(video)
  } else if (contentType?.startsWith("audio/")) {
    const audio = document.createElement("audio")
    audio.className = "lexxy-preview-modal__audio"
    audio.controls = true
    const source = document.createElement("source")
    source.src = src
    source.type = contentType
    audio.appendChild(source)
    content.appendChild(audio)
  } else {
    const wrapper = document.createElement("div")
    wrapper.className = "lexxy-preview-modal__generic"
    const genIcon = document.createElement("span")
    genIcon.className = `lexxy-preview-modal__generic-icon attachment--${ext}`
    genIcon.textContent = iconLabel(ext)

    const displayName = (caption && caption !== fileName) ? caption : (fileName || "Unknown file")
    const name = document.createElement("strong")
    name.textContent = displayName

    wrapper.append(genIcon, name)

    if (caption && caption !== fileName) {
      const subName = document.createElement("span")
      subName.className = "lexxy-preview-modal__generic-hint"
      subName.textContent = fileName
      wrapper.appendChild(subName)
    }

    const hint = document.createElement("span")
    hint.className = "lexxy-preview-modal__generic-hint"
    hint.textContent = "No preview available for this file type"
    const dl = document.createElement("a")
    dl.className = "lexxy-preview-modal__generic-download"
    dl.href = src
    dl.download = fileName || ""
    dl.textContent = "Download"
    wrapper.append(hint, dl)
    content.appendChild(wrapper)
  }

  box.appendChild(header)
  box.appendChild(content)
  dialog.appendChild(box)

  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closePreviewModal() })
  dialog.addEventListener("click", (e) => { if (!box.contains(e.target)) closePreviewModal() })
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== " ") return
    const media = dialog.querySelector("video, audio")
    if (!media || document.activeElement?.closest("button, a")) return
    e.preventDefault()
    media.paused ? media.play() : media.pause()
  })

  document.body.appendChild(dialog)
  dialog.showModal()
  box.focus()
  document.body.classList.add("lexxy-preview-modal--open")

  // Sync playback from page media to modal media (continue if was playing)
  const modalMedia = dialog.querySelector("video, audio")
  if (modalMedia && window.__previewPageMedia) {
    const wasPlaying = !window.__previewPageMedia.paused
    modalMedia.currentTime = window.__previewPageMedia.currentTime
    if (wasPlaying) {
      window.__previewPageMedia.pause()
      modalMedia.play()
    }
  }
}

function closePreviewModal() {
  document.body.classList.remove("lexxy-preview-modal--open")
  const dialog = document.getElementById("lexxy-content-preview")
  if (dialog) {
    const media = dialog.querySelector("video, audio")
    // Sync playback time back to page media
    if (media && window.__previewPageMedia) {
      window.__previewPageMedia.currentTime = media.currentTime
      window.__previewPageMedia = null
    }
    if (media && !media.paused) media.pause()
    if (dialog.open) dialog.close()
    dialog.remove()
  }
}

// Listen for clicks on preview buttons within rendered content
document.addEventListener("click", (event) => {
  const button = event.target.closest('.attachment__action[aria-label="Preview"]')
  if (!button) return

  event.preventDefault()

  const attachment = button.closest("action-text-attachment")
  const src = button.href
  const fileName = attachment?.getAttribute("filename") || src.split("/").pop()
  const contentType = attachment?.getAttribute("content-type") || ""
  const caption = attachment?.getAttribute("caption") || ""
  const fileSize = attachment?.getAttribute("filesize") || ""

  // Store reference to the page's media element for time sync
  window.__previewPageMedia = attachment?.querySelector("video, audio") || null

  button.blur()
  openPreviewModal(src, fileName, contentType, caption, fileSize)
})

// Apply custom captions from action-text-attachment elements to the rendered names.
// ActionText stores the caption attribute on the element but the blob partial
// only has access to the original filename.
function applyCustomCaptions() {
  document.querySelectorAll("action-text-attachment[caption]").forEach(att => {
    const caption = att.getAttribute("caption")
    if (!caption) return

    // Don't show custom name if caption is hidden (revert to original filename)
    if (att.hasAttribute("data-caption-hidden")) return

    const nameEl = att.querySelector(".attachment__name")
    if (nameEl) nameEl.textContent = caption

    // Hide file size for non-collapsed previewable types (images, video, gif)
    // Keep size visible on collapsed cards and file/audio attachments
    const contentType = att.getAttribute("content-type") || ""
    const isCollapsed = att.hasAttribute("data-collapsed")
    if (!isCollapsed && (contentType.startsWith("image/") || contentType.startsWith("video/"))) {
      const sizeEl = att.querySelector(".attachment__size")
      if (sizeEl) sizeEl.style.display = "none"
    }
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyCustomCaptions)
} else {
  applyCustomCaptions()
}

// Re-apply after Turbo navigations
document.addEventListener("turbo:load", applyCustomCaptions)

// When any media starts playing, pause all others
document.addEventListener("play", (event) => {
  document.querySelectorAll("video, audio").forEach(m => {
    if (m !== event.target && !m.paused) m.pause()
  })
}, true)
