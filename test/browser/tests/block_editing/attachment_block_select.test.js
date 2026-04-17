import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { normalizeHtml } from "../../helpers/html.js"
import { mockActiveStorageUploads } from "../../helpers/active_storage_mock.js"

function stripDynamicAttrs(html) {
  return html
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
    .replace(/\s*data-block-movement-wrapped="[^"]*"/g, "")
}

const modifier = process.platform === "darwin" ? "Meta" : "Control"

// TURN_INTO_OPTIONS: Text=0, H2=1, H3=2, H4=3, Bullet=4, Numbered=5, Quote=6, Code=7.
async function openMenuAndTurnIntoIndex(page, editor, submenuIndex) {
  // Ensure block-select mode is active before opening the menu — the menu
  // handler is registered on the editor and only opens in block-select mode.
  // After a Turn into, #syncAndRefocus uses double-RAF before applying
  // .lexxy-editor__block--focused, so poll patiently to avoid races between consecutive
  // menu operations.
  await expect.poll(async () => {
    return await editor.content.locator(".lexxy-editor__block--focused").count()
  }, { timeout: 5000 }).toBe(1)

  await page.keyboard.press(`${modifier}+/`)
  const menu = page.locator("lexxy-block-actions")
  await expect(menu).toBeVisible({ timeout: 5000 })

  await page.keyboard.press("ArrowRight")
  for (let i = 0; i < submenuIndex; i++) {
    await page.keyboard.press("ArrowDown")
  }
  await page.keyboard.press("Enter")
  await expect(menu).toBeHidden({ timeout: 5000 })
}

// Upload an image and return the locator for the attachment figure.
// Seeds a "anchor" paragraph above so we can reliably place the caret
// somewhere stable, then arrow-navigate to the attachment in block-select.
async function uploadAndWait(editor, page) {
  await editor.setValue("<p>anchor</p>")
  await editor.click()
  await editor.send("End")

  await editor.uploadFile("test/fixtures/files/example.png")
  const figure = page.locator("figure.attachment[data-content-type='image/png']")
  await expect(figure).toBeVisible({ timeout: 10_000 })

  // Wait for the upload to fully transition to a CustomActionTextAttachment
  // node — the value attribute is what block-select sees, not just the DOM.
  await expect.poll(async () => {
    return await editor.value()
  }, { timeout: 10_000 }).toMatch(/<action-text-attachment[^>]*sgid="mock-sgid/)
  await editor.flush()
  return figure
}

// Enter block-select mode and focus the attachment block.
async function selectAttachment(_figure, editor, page) {
  // Place caret in the anchor paragraph (attachment may have moved focus).
  await editor.select("anchor")
  await page.keyboard.press("Escape")
  // We're now in block-select on the anchor paragraph. Move down to the
  // attachment block.
  await expect(editor.content.locator(".lexxy-editor__block--focused")).toHaveCount(1, { timeout: 5000 })
  await page.keyboard.press("ArrowDown")
  // Confirm focus moved off the anchor paragraph (attachment is now focused).
  await expect.poll(async () => {
    return await editor.content.locator(".lexxy-editor__block--focused").evaluate(el => el.textContent)
  }, { timeout: 5000 }).not.toBe("anchor")
}

test.describe("Attachments in block-select mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/attachments.html")
    await page.waitForSelector("lexxy-editor[connected]")
    await page.waitForSelector("lexxy-toolbar[connected]")
  })

  test("Turn into Bullet on a focused attachment wraps it as a list item; sgid preserved", async ({ editor, page }) => {
    await mockActiveStorageUploads(page)
    const figure = await uploadAndWait(editor, page)
    await selectAttachment(figure, editor, page)

    // Capture the original sgid so we can verify it survives wrapping.
    const beforeHtml = await editor.value()
    const sgidMatch = beforeHtml.match(/sgid="([^"]+)"/)
    expect(sgidMatch).not.toBeNull()
    const sgid = sgidMatch[1]

    await openMenuAndTurnIntoIndex(page, editor, 4) // Bullet list

    const html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    // Wrapped: action-text-attachment lives inside <li> inside <ul>.
    expect(html).toMatch(/<ul>[^]*<li[^>]*>[^]*<action-text-attachment[^]*<\/action-text-attachment>[^]*<\/li>[^]*<\/ul>/)
    // Sgid preserved through the wrap.
    expect(html).toContain(`sgid="${sgid}"`)
  })

  test("Shift+Tab on a wrapped attachment at root unwraps to standalone", async ({ editor, page }) => {
    await mockActiveStorageUploads(page)
    const figure = await uploadAndWait(editor, page)
    await selectAttachment(figure, editor, page)
    await openMenuAndTurnIntoIndex(page, editor, 4)

    // Confirm wrapped before outdent.
    let html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).toMatch(/<ul>[^]*<action-text-attachment/)

    await page.keyboard.press("Shift+Tab")
    await editor.flush()

    html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    // Unwrapped: action-text-attachment back at root, no surrounding <ul>.
    expect(html).not.toMatch(/<ul>[^]*<action-text-attachment/)
    expect(html).toMatch(/<action-text-attachment[^]*<\/action-text-attachment>/)
  })

  test("Remove Bullet on a wrapped attachment unwraps to root", async ({ editor, page }) => {
    await mockActiveStorageUploads(page)
    const figure = await uploadAndWait(editor, page)
    await selectAttachment(figure, editor, page)
    await openMenuAndTurnIntoIndex(page, editor, 4)

    // Confirm wrapped.
    let html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).toMatch(/<ul>[^]*<action-text-attachment/)

    await page.keyboard.press(`${modifier}+/`)
    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    // Main panel order: Turn into, Color, Remove Bullet, Duplicate, Delete.
    await page.keyboard.press("ArrowDown") // Color
    await page.keyboard.press("ArrowDown") // Remove Bullet
    await page.keyboard.press("Enter")
    await expect(menu).toBeHidden({ timeout: 2000 })

    html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).not.toMatch(/<ul>[^]*<action-text-attachment/)
    expect(html).toMatch(/<action-text-attachment/)
  })

  test("Remove Quote on an attachment wrapped in a blockquote unwraps to root", async ({ editor, page }) => {
    await mockActiveStorageUploads(page)
    const figure = await uploadAndWait(editor, page)
    await selectAttachment(figure, editor, page)

    // Wrap in Quote (TURN_INTO index 6).
    await openMenuAndTurnIntoIndex(page, editor, 6)

    let html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).toMatch(/<blockquote>[^]*<action-text-attachment/)

    // Remove Quote via menu.
    await page.keyboard.press(`${modifier}+/`)
    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    // Main panel: Turn into, Color, Remove Quote, Duplicate, Delete.
    await page.keyboard.press("ArrowDown") // Color
    await page.keyboard.press("ArrowDown") // Remove Quote
    await page.keyboard.press("Enter")
    await expect(menu).toBeHidden({ timeout: 2000 })

    html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).not.toContain("<blockquote>")
    expect(html).toMatch(/<action-text-attachment/)
  })

  test("Remove Bullet on an attachment in a blockquote in a list extracts to root in one click", async ({ editor, page }) => {
    // Compound wrappers — commit d9654ab3 made Remove Quote/Bullet peel
    // every wrapper layer, not just the immediate one.
    await mockActiveStorageUploads(page)
    const figure = await uploadAndWait(editor, page)
    await selectAttachment(figure, editor, page)

    // Wrap in Bullet, then Quote — produces <ul><li><blockquote><attachment/></blockquote></li></ul>.
    await openMenuAndTurnIntoIndex(page, editor, 4)
    await openMenuAndTurnIntoIndex(page, editor, 6)

    let html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).toMatch(/<ul>[^]*<li[^>]*>[^]*<blockquote>[^]*<action-text-attachment/)

    // Remove Bullet — should peel BOTH the bullet and the blockquote.
    await page.keyboard.press(`${modifier}+/`)
    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await page.keyboard.press("ArrowDown") // Color
    await page.keyboard.press("ArrowDown") // Remove Bullet
    await page.keyboard.press("Enter")
    await expect(menu).toBeHidden({ timeout: 2000 })

    html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).not.toContain("<ul>")
    expect(html).not.toContain("<blockquote>")
    expect(html).toMatch(/<action-text-attachment/)
  })

  test("Cmd+Shift+Down moves a wrapped attachment past its sibling, keeping it wrapped", async ({ editor, page }) => {
    await mockActiveStorageUploads(page)
    // uploadAndWait seeds a "anchor" paragraph above the upload, which acts
    // as the sibling we'll move the wrapped attachment past.
    const figure = await uploadAndWait(editor, page)
    await selectAttachment(figure, editor, page)

    await openMenuAndTurnIntoIndex(page, editor, 4) // Bullet wrap

    let html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(html).toMatch(/<p>anchor<\/p>[^]*<ul>[^]*<action-text-attachment/)

    // Move the wrapped attachment up past anchor.
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`)
    await editor.flush()

    html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    // Wrapped attachment is now first, anchor paragraph second.
    expect(html).toMatch(/<ul>[^]*<action-text-attachment[^]*<\/action-text-attachment>[^]*<\/ul>[^]*<p>anchor<\/p>/)
  })
})
