import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { normalizeHtml } from "../../helpers/html.js"

function stripDynamicAttrs(html) {
  return html
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
}

async function assertBlockHtml(editor, expected) {
  await expect
    .poll(
      async () => {
        await editor.flush()
        return stripDynamicAttrs(normalizeHtml(await editor.value()))
      },
      { timeout: 5_000 },
    )
    .toBe(stripDynamicAttrs(normalizeHtml(expected)))
}

const modifier = process.platform === "darwin" ? "Meta" : "Control"

test.describe("Block actions menu (Cmd+/)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("Cmd+/ opens block actions menu in block-select mode", async ({ editor, page }) => {
    await editor.setValue("<p>Hello world</p>")
    await editor.select("Hello")
    await page.keyboard.press("Escape")

    await expect(editor.content.locator(".block--focused")).toHaveCount(1)

    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
  })

  test("block actions menu shows delete and duplicate options", async ({ editor, page }) => {
    await editor.setValue("<p>First</p><p>Second</p>")
    await editor.select("First")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await expect(menu.locator("[data-action='delete']")).toBeAttached()
    await expect(menu.locator("[data-action='duplicate']")).toBeAttached()
  })

  test("delete action removes the focused block", async ({ editor, page }) => {
    await editor.setValue("<p>Keep</p><p>Remove me</p><p>Also keep</p>")
    await editor.select("Remove me")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Navigate to Delete (4th item: Turn into, Color, Duplicate, Delete)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    await assertBlockHtml(editor, "<p>Keep</p><p>Also keep</p>")
  })

  test("duplicate action copies the focused block", async ({ editor, page }) => {
    await editor.setValue("<p>Original</p><p>Other</p>")
    await editor.select("Original")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Navigate to Duplicate (3rd item: Turn into, Color, Duplicate)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    const count = (html.match(/Original/g) || []).length
    expect(count).toBe(2)
  })

  test("turn-into submenu converts paragraph to heading", async ({ editor, page }) => {
    await editor.setValue("<p>Make me a heading</p>")
    await editor.select("Make me")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // First item is "Turn into" — press ArrowRight to enter submenu
    await page.keyboard.press("ArrowRight")
    // First submenu item is "Text", second is "Heading 2"
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    await assertBlockHtml(editor, "<h2>Make me a heading</h2>")
  })

  test("Escape closes the block actions menu", async ({ editor, page }) => {
    await editor.setValue("<p>Test</p>")
    await editor.select("Test")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    await page.keyboard.press("Escape")
    await expect(menu).not.toBeVisible({ timeout: 2000 })
  })
})
