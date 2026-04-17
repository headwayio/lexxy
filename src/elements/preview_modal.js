import Lexxy from "../config/lexxy"
import { buildPreviewDialog } from "./preview/dialog_builder"
import { attachPlaybackSync, installPauseOthers } from "./preview/playback_sync"

// <lexxy-preview-modal> is registered by the editor when the host app opts
// in via Lexxy.configure({ global: { previewModal: true } }). It listens for
// lexxy:preview-attachment events dispatched by the eye button inside the
// editor's attachment controls and renders a <dialog>-based preview using
// the shared builder (src/preview/dialog_builder.js).
export class PreviewModal extends HTMLElement {
  #close = null
  #handlePreviewEvent = null

  connectedCallback() {
    if (!Lexxy.global.get("previewModal")) return

    this.#handlePreviewEvent = (event) => this.#onPreviewRequest(event)
    document.addEventListener("lexxy:preview-attachment", this.#handlePreviewEvent)

    installPauseOthers()
  }

  disconnectedCallback() {
    if (this.#handlePreviewEvent) {
      document.removeEventListener("lexxy:preview-attachment", this.#handlePreviewEvent)
    }
    this.#close?.()
  }

  #onPreviewRequest(event) {
    if (event.defaultPrevented) return

    const { src, blobUrl, fileName, contentType, fileSize, caption, pageMedia } = event.detail
    if (!src && !blobUrl) return

    this.#open({ src, blobUrl, fileName, contentType, fileSize, caption, pageMedia })
  }

  #open({ pageMedia, ...dialogOptions }) {
    this.#close?.()

    const { dialog, box, close } = buildPreviewDialog(dialogOptions)
    this.#close = close

    document.body.appendChild(dialog)
    dialog.showModal()
    box.focus()
    document.body.classList.add("lexxy-preview-modal--open")

    attachPlaybackSync(dialog, pageMedia)
  }
}

export default PreviewModal
