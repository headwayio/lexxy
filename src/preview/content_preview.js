// Standalone preview modal for rendered ActionText content on show pages.
// Bundled separately by rollup to app/assets/javascript/lexxy-content-preview.js
// so host apps can `pin "lexxy-content-preview"` and `import` it without
// pulling in the editor.
//
// Listens for clicks on .attachment__action[aria-label="Preview"] inside
// rendered content, opens a <dialog> via the shared builder, and keeps
// media-playback time in sync across inline ↔ modal transitions.
import { buildPreviewDialog } from "./dialog_builder"

const DIALOG_ID = "lexxy-content-preview"
let pageMedia = null

function openPreview({ src, fileName, contentType, caption, fileSize }) {
  closePreview()

  const { dialog, box } = buildPreviewDialog({ src, fileName, contentType, caption, fileSize })
  dialog.id = DIALOG_ID

  document.body.appendChild(dialog)
  dialog.showModal()
  box.focus()
  document.body.classList.add("lexxy-preview-modal--open")

  // Sync playback time from the inline page media element so the modal
  // resumes where the user left off (and keep playing if it was playing).
  const modalMedia = dialog.querySelector("video, audio")
  if (modalMedia && pageMedia) {
    const wasPlaying = !pageMedia.paused
    modalMedia.currentTime = pageMedia.currentTime
    if (wasPlaying) {
      pageMedia.pause()
      modalMedia.play()
    }
  }
}

function closePreview() {
  const dialog = document.getElementById(DIALOG_ID)
  if (!dialog) return

  // Sync playback time back so the inline player resumes from the same spot.
  const media = dialog.querySelector("video, audio")
  if (media && pageMedia) {
    pageMedia.currentTime = media.currentTime
    pageMedia = null
  }
  if (media && !media.paused) media.pause()

  if (dialog.open) dialog.close()
  dialog.remove()
  document.body.classList.remove("lexxy-preview-modal--open")
}

// ActionText stores the caption attribute on <action-text-attachment> but the
// server-rendered blob partial only has access to the original filename. Walk
// the page after render and swap in the custom caption where present.
function applyCustomCaptions() {
  document.querySelectorAll("action-text-attachment[caption]").forEach(attachment => {
    const caption = attachment.getAttribute("caption")
    if (!caption || attachment.hasAttribute("data-caption-hidden")) return

    const nameEl = attachment.querySelector(".attachment__name")
    if (nameEl) nameEl.textContent = caption

    // Hide file size on non-collapsed image/video previews — the caption
    // already carries the meaningful label. Collapsed cards and file/audio
    // attachments still show the size.
    const contentType = attachment.getAttribute("content-type") || ""
    const isCollapsed = attachment.hasAttribute("data-collapsed")
    if (!isCollapsed && (contentType.startsWith("image/") || contentType.startsWith("video/"))) {
      const sizeEl = attachment.querySelector(".attachment__size")
      if (sizeEl) sizeEl.style.display = "none"
    }
  })
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".attachment__action[aria-label=\"Preview\"]")
  if (!button) return

  event.preventDefault()

  const attachment = button.closest("action-text-attachment")
  const src = button.href
  const fileName = attachment?.getAttribute("filename") || src.split("/").pop()
  const contentType = attachment?.getAttribute("content-type") || ""
  const caption = attachment?.getAttribute("caption") || ""
  const fileSize = attachment?.getAttribute("filesize") || ""

  pageMedia = attachment?.querySelector("video, audio") || null

  button.blur()
  openPreview({ src, fileName, contentType, caption, fileSize })
})

// When any media starts playing, pause all others on the page. Matches the
// editor's pause-others behaviour for a consistent UX.
document.addEventListener("play", (event) => {
  document.querySelectorAll("video, audio").forEach(media => {
    if (media !== event.target && !media.paused) media.pause()
  })
}, true)

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyCustomCaptions)
} else {
  applyCustomCaptions()
}

document.addEventListener("turbo:load", applyCustomCaptions)
