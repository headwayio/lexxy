import { dispatch } from "./html_helper"
import { representationToBlobUrl } from "./storage_helper"

// Build the detail payload for a `lexxy:preview-attachment` event from the
// live figure element. Reading from the DOM — rather than from the Lexical
// node model — matters for SVG: cachedSvgObjectUrl swaps the inline <img>'s
// src to a `blob:` object URL at render time (ActiveStorage serves
// image/svg+xml with Content-Disposition: attachment, which <img> won't
// render inline). Reading from the node model would hand the modal the raw
// ActiveStorage URL and the SVG would render blank.
export function attachmentPreviewDetail(figure) {
  const nameText = figure.querySelector(".attachment__name")?.textContent
  const textareaText = figure.querySelector("figcaption textarea")?.value
  const fileName = figure.dataset.fileName || ""
  const candidate = (figure.dataset.caption || nameText || textareaText || "").trim()
  const caption = candidate && candidate !== fileName ? candidate : ""
  const src = figure.querySelector("img")?.src || figure.dataset.src

  return {
    src,
    blobUrl: figure.dataset.blobUrl || representationToBlobUrl(src),
    fileName,
    contentType: figure.dataset.contentType,
    fileSize: figure.dataset.fileSize,
    sgid: figure.dataset.sgid,
    caption,
    pageMedia: figure.querySelector("video, audio") || null,
  }
}

export function dispatchAttachmentPreview(figure) {
  dispatch(figure, "lexxy:preview-attachment", attachmentPreviewDetail(figure), true)
}
