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
