import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { normalizeHtml } from "../../helpers/html.js"

// Assert editor HTML, stripping dynamic attributes (data-bullet-depth,
// data-list-item-type) that EarlyEscapeListItemNode adds at runtime.
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

function stripDynamicAttrs(html) {
  return html
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
}

test.describe("Block selection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("Escape key enters block-select mode on the current block", async ({ editor, page }) => {
    await editor.setValue("<p>First</p><p>Second</p><p>Third</p>")
    await editor.select("Second")
    await page.keyboard.press("Escape")

    await expect(editor.content.locator(".block--focused")).toHaveCount(1)
    await expect(editor.content.locator(".block--focused")).toContainText("Second")
  })

  test("Arrow keys navigate between blocks in block-select mode", async ({ editor, page }) => {
    await editor.setValue("<p>First</p><p>Second</p><p>Third</p>")
    await editor.select("Second")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown")

    await expect(editor.content.locator(".block--focused")).toContainText("Third")

    await page.keyboard.press("ArrowUp")
    await page.keyboard.press("ArrowUp")

    await expect(editor.content.locator(".block--focused")).toContainText("First")
  })

  test("Enter key exits block-select mode and places cursor in focused block", async ({ editor, page }) => {
    await editor.setValue("<p>First</p><p>Second</p><p>Third</p>")
    await editor.select("First")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    // Should have exited block-select mode
    await expect(editor.content.locator(".block--focused")).toHaveCount(0)
    await expect(editor.content.locator(".block--selected")).toHaveCount(0)
  })

  test("Delete key removes selected block", async ({ editor, page }) => {
    await editor.setValue("<p>First</p><p>Second</p><p>Third</p>")
    await editor.select("Second")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Delete")

    await assertBlockHtml(editor, "<p>First</p><p>Third</p>")
  })

  test("Escape on a list item selects the list item", async ({ editor, page }) => {
    await editor.setValue("<ul><li>Item one</li><li>Item two</li></ul>")
    await editor.select("Item two")
    await page.keyboard.press("Escape")

    const focused = editor.content.locator(".block--focused")
    await expect(focused).toHaveCount(1)
    await expect(focused).toContainText("Item two")
  })

  test("Cmd+Shift+Down nests a list item under its previous sibling", async ({ editor, page }) => {
    await editor.setValue("<ul><li>Parent</li><li>Child</li></ul>")
    await editor.select("Child")
    await page.keyboard.press("Escape")

    const modifier = process.platform === "darwin" ? "Meta" : "Control"
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`)

    await assertBlockHtml(
      editor,
      '<ul><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Child</li></ul></li></ul>'
    )
  })

  test("Tab indents a list item in block-select mode", async ({ editor, page }) => {
    await editor.setValue("<ul><li>First</li><li>Second</li></ul>")
    await editor.select("Second")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Tab")

    await assertBlockHtml(
      editor,
      '<ul><li>First</li><li class="lexxy-nested-listitem"><ul><li>Second</li></ul></li></ul>'
    )
  })

  test("Shift+Tab outdents a list item in block-select mode", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>First</li><li class="lexxy-nested-listitem"><ul><li>Nested</li></ul></li></ul>'
    )
    await editor.select("Nested")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(
      editor,
      "<ul><li>First</li><li>Nested</li></ul>"
    )
  })

  test("Cmd+D duplicates the focused block", async ({ editor, page }) => {
    await editor.setValue("<p>Original</p><p>Other</p>")
    await editor.select("Original")
    await page.keyboard.press("Escape")

    const modifier = process.platform === "darwin" ? "Meta" : "Control"
    await page.keyboard.press(`${modifier}+d`)

    // Should have two copies of "Original"
    const html = await editor.value()
    const count = (html.match(/Original/g) || []).length
    expect(count).toBe(2)
  })

  test("Cmd+Shift+Down at bottom of list promotes item", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Nested</li></ul></li></ul>'
    )
    await editor.select("Nested")
    await page.keyboard.press("Escape")

    const modifier = process.platform === "darwin" ? "Meta" : "Control"
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)

    await assertBlockHtml(editor, "<ul><li>Parent</li><li>Nested</li></ul>")
  })
})
