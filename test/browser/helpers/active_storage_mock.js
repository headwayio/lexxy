// Mocks the Active Storage direct upload endpoints using Playwright route interception.
// Returns a handle for asserting that the expected calls were made.

// 160×120 SVG placeholder served in place of real blob URLs. The explicit
// dimensions guarantee the <img> has real height — otherwise the figure
// collapses and the hover-activated floating controls cover the caption
// textarea, making Playwright click checks fail.
const PLACEHOLDER_IMAGE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='160' height='120' fill='#d8d5cf'/></svg>"

export async function mockActiveStorageUploads(page, { delayBlobResponses = false, delayDirectUploadResponse = false } = {}) {
  let blobCounter = 0
  const calls = { blobCreations: [], fileUploads: [] }
  const pendingBlobRoutes = []
  const pendingDirectUploadRoutes = []
  let blobsReleased = false
  let directUploadReleased = false

  // When delayBlobResponses is true, GET /blobs/* requests are held until
  // calls.releaseBlobResponses() is called. This lets tests assert the local
  // preview is visible before the server image arrives. Idempotent: once
  // released, any subsequent blob requests are fulfilled immediately.
  calls.releaseBlobResponses = async () => {
    blobsReleased = true
    await Promise.all(pendingBlobRoutes.map(fulfill => fulfill()))
    pendingBlobRoutes.length = 0
  }

  // When delayDirectUploadResponse is true, POST /direct_uploads responses are
  // held until calls.releaseDirectUploadResponses() is called. This lets tests
  // keep uploads pending while typing, then release completion deterministically.
  calls.releaseDirectUploadResponses = async () => {
    directUploadReleased = true
    await Promise.all(pendingDirectUploadRoutes.map(fulfill => fulfill()))
    pendingDirectUploadRoutes.length = 0
  }

  // POST /rails/active_storage/direct_uploads — creates a blob record
  await page.route("**/rails/active_storage/direct_uploads", async (route) => {
    const request = route.request()
    if (request.method() !== "POST") return route.fallback()

    const body = JSON.parse(request.postData())
    const blob = body.blob
    const blobId = ++blobCounter
    const signedId = `mock-signed-id-${blobId}`

    calls.blobCreations.push(blob)

    // Non-image previewable types (PDFs, videos) get a preview URL from the
    // server. Images are handled via isPreviewableImage and don't need this.
    const previewable = blob.content_type === "application/pdf" ||
      blob.content_type.startsWith("video/")

    const fulfill = async () => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: blobId,
          key: `test-key-${blobId}`,
          filename: blob.filename,
          content_type: blob.content_type,
          byte_size: blob.byte_size,
          checksum: blob.checksum,
          signed_id: signedId,
          attachable_sgid: `mock-sgid-${blobId}`,
          previewable: previewable || undefined,
          url: previewable ? `/rails/active_storage/blobs/${signedId}/previews/full` : undefined,
          direct_upload: {
            url: `/rails/active_storage/disk/${signedId}`,
            headers: { "Content-Type": blob.content_type },
          },
        }),
      })
    }

    if (delayDirectUploadResponse && !directUploadReleased) {
      pendingDirectUploadRoutes.push(fulfill)
    } else {
      await fulfill()
    }
  })

  // GET /rails/active_storage/blobs/* — serves the uploaded file back (for preload)
  await page.route("**/rails/active_storage/blobs/**", async (route) => {
    const request = route.request()
    if (request.method() !== "GET") return route.fallback()

    const url = new URL(request.url())
    const filename = decodeURIComponent(url.pathname.split("/").pop())
    const blob = calls.blobCreations.find(b => b.filename === filename)
    const contentType = blob?.content_type || "application/octet-stream"

    const fulfill = async () => {
      // Serve the fixture file if it exists (needed for the preview-swap test with
      // delayBlobResponses). Otherwise fall back to a 160×120 SVG placeholder — the
      // explicit dimensions prevent the figure from collapsing, which would otherwise
      // cover the caption textarea with hover-activated floating controls and break
      // Playwright click checks. SVG also keeps the image small enough to avoid
      // layout-shift breaking drag-and-drop tests.
      const fs = await import("fs")
      const fixturePath = `test/fixtures/files/${filename}`
      if (delayBlobResponses && fs.existsSync(fixturePath)) {
        await route.fulfill({ status: 200, contentType, path: fixturePath })
      } else {
        await route.fulfill({ status: 200, contentType: "image/svg+xml", body: PLACEHOLDER_IMAGE_SVG })
      }
    }

    if (delayBlobResponses && !blobsReleased) {
      pendingBlobRoutes.push(fulfill)
    } else {
      await fulfill()
    }
  })

  // PUT /rails/active_storage/disk/* — stores the file bytes
  await page.route("**/rails/active_storage/disk/**", async (route) => {
    const request = route.request()
    if (request.method() !== "PUT") return route.fallback()

    calls.fileUploads.push({
      url: request.url(),
      contentType: request.headers()["content-type"],
    })

    await route.fulfill({ status: 204 })
  })

  return calls
}
