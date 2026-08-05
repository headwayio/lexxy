export function bytesToHumanSize(bytes) {
  if (bytes === 0) return "0 B"
  const sizes = [ "B", "KB", "MB", "GB", "TB", "PB" ]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${ value.toFixed(2) } ${ sizes[i] }`
}

export function extractFileName(string) {
  return string.split("/").pop()
}

// Lowercase file extension (no leading dot). Returns "" for names without a
// dot; the caller decides whether to fall back to "unknown" or similar.
export function extractFileExtension(fileName) {
  if (!fileName || !fileName.includes(".")) return ""
  return fileName.split(".").pop().toLowerCase()
}

// The content attribute is raw HTML (matching Trix/ActionText). Older Lexxy
// versions JSON-encoded it, so try JSON.parse first for backward compatibility.
export function parseAttachmentContent(content) {
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

export function mimeTypeToExtension(mimeType) {
  if (!mimeType) return null

  const extension = mimeType.split("/")[1]
  return extension
}

// For playable media (video, audio, PDFs), the stored url/src is often an
// Active Storage representation URL (a thumbnail image), not the blob itself.
// Rewrite /representations/redirect/<signed_id>/<variation>/<file> into
// /blobs/redirect/<signed_id>/<file> so the actual file can be streamed.
// Returns the original URL unchanged if it's not a representation URL.
export function representationToBlobUrl(url) {
  if (!url) return null
  return url.replace(
    /\/rails\/active_storage\/representations\/redirect\/([^/]+)\/[^/]+\/([^?]+)/,
    "/rails/active_storage/blobs/redirect/$1/$2"
  )
}

const LAST_USED_COLOR_KEY = "lexxy-last-color"

// Persist the most-recently-applied highlight color so the next color apply
// (via block-actions menu or highlight dropdown) can one-tap re-apply it.
// Scoped to localStorage so it survives a refresh and is shared across every
// editor on the same origin — which matches user intent ("reuse my last
// color"). Callers provide a `label` string for the menu to display.
export function saveLastUsedColor({ style, value, label }) {
  try {
    localStorage.setItem(LAST_USED_COLOR_KEY, JSON.stringify({ style, value, label }))
  } catch { /* localStorage may be unavailable (private mode, quota) */ }
}

export function getLastUsedColor() {
  try {
    const stored = localStorage.getItem(LAST_USED_COLOR_KEY)
    return stored ? JSON.parse(stored) : null
  } catch { return null }
}
