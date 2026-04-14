// Mocks the two Active Storage direct upload endpoints using Playwright route interception.
// Returns a handle for asserting that the expected calls were made.

// 160×120 SVG placeholder served in place of real blob URLs. The explicit
// dimensions guarantee the <img> has real height — otherwise the figure
// collapses and the hover-activated floating controls cover the caption
// textarea, making Playwright click checks fail.
const PLACEHOLDER_IMAGE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='160' height='120' fill='#d8d5cf'/></svg>"

export async function mockActiveStorageUploads(page) {
  let blobCounter = 0
  const calls = { blobCreations: [], fileUploads: [] }

  // POST /rails/active_storage/direct_uploads — creates a blob record
  await page.route("**/rails/active_storage/direct_uploads", async (route) => {
    const request = route.request()
    if (request.method() !== "POST") return route.fallback()

    const body = JSON.parse(request.postData())
    const blob = body.blob
    const signedId = `mock-signed-id-${++blobCounter}`

    calls.blobCreations.push(blob)

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: blobCounter,
        key: `test-key-${blobCounter}`,
        filename: blob.filename,
        content_type: blob.content_type,
        byte_size: blob.byte_size,
        checksum: blob.checksum,
        signed_id: signedId,
        attachable_sgid: `mock-sgid-${blobCounter}`,
        direct_upload: {
          url: `/rails/active_storage/disk/${signedId}`,
          headers: { "Content-Type": blob.content_type },
        },
      }),
    })
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

  // GET /rails/active_storage/blobs/<signed_id>/<filename> — serves the blob
  // preview so the rendered <img> has real dimensions.
  await page.route("**/rails/active_storage/blobs/**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: PLACEHOLDER_IMAGE_SVG,
    })
  })

  return calls
}
