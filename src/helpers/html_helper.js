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

const ICON_LABELS = {
  md: "M\u2193",
  markdown: "M\u2193",
  xlsx: "XLS",
  docx: "DOC",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
  webp: "IMG",
  svg: "IMG",
  bmp: "IMG",
  tiff: "IMG",
  tif: "IMG",
  ico: "IMG",
  avif: "IMG",
  heic: "IMG"
}

export function attachmentIconLabel(extension) {
  return ICON_LABELS[extension] || extension
}

export function isPreviewableImage(contentType) {
  return contentType.startsWith("image/") && !contentType.includes("svg")
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
