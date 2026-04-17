import { extractFileExtension } from "./storage_helper"

export function createElement(name, properties, content = "") {
  const element = document.createElement(name)
  for (const [ key, value ] of Object.entries(properties || {})) {
    if (key === "dataset") {
      Object.entries(value).forEach(([ key, value ]) => (element.dataset[key] = value))
    } else if (key in element) {
      element[key] = value
    } else if (value !== null && value !== undefined) {
      element.setAttribute(key, value)
    }
  }
  if (content) {
    element.innerHTML = content
  }
  return element
}

export function parseHtml(html) {
  const parser = new DOMParser()
  return parser.parseFromString(html, "text/html")
}

export function createAttachmentFigure(contentType, isPreviewable, fileName) {
  const extension = extractFileExtension(fileName) || "unknown"
  return createElement("figure", {
    className: `attachment attachment--${isPreviewable ? "preview" : "file"} attachment--${extension}`,
    "data-content-type": contentType
  })
}

// Extension → short label shown inside .attachment__icon. Any extension not in
// this map falls back to its uppercased form (".sql" → "SQL"). Keep in sync
// with Lexxy::AttachmentIconHelper on the Ruby side — the show-page
// _blob.html.erb partial uses the same labels.
const ICON_LABELS = {
  md: "M\u2193",
  markdown: "M\u2193",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
  webp: "IMG",
  svg: "SVG",
  bmp: "IMG",
  tiff: "IMG",
  tif: "IMG",
  ico: "IMG",
  avif: "IMG",
  heic: "IMG",
  docx: "DOC",
  xlsx: "XLS",
  pptx: "PPT",
  rar: "ZIP",
  webm: "VID",
  avi: "VID"
}

export function attachmentIconLabel(extension) {
  if (!extension) return ""
  return ICON_LABELS[extension] || extension.toUpperCase()
}

export function isPreviewableImage(contentType) {
  return contentType.startsWith("image/")
}

export function dispatch(element, eventName, detail = null, cancelable = false) {
  return element.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail, cancelable }))
}

export function addBlockSpacing(doc) {
  const selector = "body > :not(h1, h2, h3, h4, h5, h6) + *, blockquote > :not(h1, h2, h3, h4, h5, h6) + *"
  for (const block of doc.querySelectorAll(selector)) {
    const spacer = doc.createElement("p")
    spacer.appendChild(doc.createElement("br"))
    block.before(spacer)
  }
}

export function generateDomId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${randomPart}`
}

export function extractPlainTextFromHtml(innerHtml = "") {
  return parseHtml(innerHtml).body.textContent.trim()
}

export function isActiveAndVisible(element) {
  return element && !element.disabled && checkVisibility(element)
}

// no `checkVisibility` in Safari < 17.4
// https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility#browser_compatibility
function checkVisibility(element, options) {
  if (element.checkVisibility) {
    return element.checkVisibility(options)
  } else {
    if (options) throw new Error("Polyfilled checkVisibility does not support options")
    // Will not work for body or a fixed position element child of the body
    // which is OK since that doesn't apply in the toolbar where this is used
    return Boolean(element.offsetParent)
  }
}
