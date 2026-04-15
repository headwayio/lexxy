export function createElement(name, properties, content = "") {
  const element = document.createElement(name)
  for (const [ key, value ] of Object.entries(properties || {})) {
    if (key in element) {
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
  const extension = fileName ? fileName.split(".").pop().toLowerCase() : "unknown"
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

export function dispatchCustomEvent(element, name, detail) {
  const event = new CustomEvent(name, {
    detail: detail,
    bubbles: true,
  })
  element.dispatchEvent(event)
}

export function dispatch(element, eventName, detail = null, cancelable = false) {
  return element.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail, cancelable }))
}

export function addBlockSpacing(doc) {
  const blocks = doc.querySelectorAll("body > :not(h1, h2, h3, h4, h5, h6) + *")
  for (const block of blocks) {
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
