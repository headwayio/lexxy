// Standalone preview modal for rendered ActionText content on show pages.
// Bundled separately by rollup to app/assets/javascript/lexxy-content-preview.js
// so host apps can `pin "lexxy-content-preview"` and `import` it without
// pulling in the editor.
//
// Listens for clicks on .attachment__action[aria-label="Preview"] inside
// rendered content, opens a <dialog> via the shared builder, and keeps
// media-playback time in sync across inline ↔ modal transitions.
import { buildPreviewDialog } from "../elements/preview/dialog_builder"
import { attachPlaybackSync, installPauseOthers } from "../elements/preview/playback_sync"

const DIALOG_ID = "lexxy-content-preview"

function openPreview({ src, fileName, contentType, caption, fileSize, pageMedia }) {
  const existing = document.getElementById(DIALOG_ID)
  if (existing) existing.remove()

  const { dialog, box } = buildPreviewDialog({ src, fileName, contentType, caption, fileSize })
  dialog.id = DIALOG_ID

  document.body.appendChild(dialog)
  dialog.showModal()
  box.focus()
  document.body.classList.add("lexxy-preview-modal--open")

  attachPlaybackSync(dialog, pageMedia)
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".attachment__action[aria-label=\"Open\"]")
  if (!button) return

  event.preventDefault()

  const attachment = button.closest("action-text-attachment")
  const src = button.href
  const fileName = attachment?.getAttribute("filename") || src.split("/").pop()
  const contentType = attachment?.getAttribute("content-type") || ""
  const caption = attachment?.getAttribute("caption") || ""
  const fileSize = attachment?.getAttribute("filesize") || ""
  const pageMedia = attachment?.querySelector("video, audio") || null

  button.blur()
  openPreview({ src, fileName, contentType, caption, fileSize, pageMedia })
})

installPauseOthers()

// Signal to CSS that the preview modal is available so the eye button
// becomes visible in rendered content. Apps that skip this import get
// a download-only action bar, leaving preview handling to themselves.
document.documentElement.classList.add("lexxy-content-preview-enabled")
