import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"

test.describe("Block editing public API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("hasBlockSelection returns false in edit mode", async ({ editor, page }) => {
    await editor.setValue("<p>Hello</p>")

    const result = await editor.locator.evaluate(el => el.hasBlockSelection)
    expect(result).toBe(false)
  })

  test("hasBlockSelection returns true after entering block-select mode", async ({ editor, page }) => {
    await editor.setValue("<p>Hello</p>")
    await editor.select("Hello")
    await page.keyboard.press("Escape")

    await expect(editor.content.locator(".block--focused")).toHaveCount(1)

    const result = await editor.locator.evaluate(el => el.hasBlockSelection)
    expect(result).toBe(true)
  })

  test("hasBlockSelection returns false after exiting block-select mode", async ({ editor, page }) => {
    await editor.setValue("<p>Hello</p>")
    await editor.select("Hello")
    await page.keyboard.press("Escape")

    await expect(editor.content.locator(".block--focused")).toHaveCount(1)
    expect(await editor.locator.evaluate(el => el.hasBlockSelection)).toBe(true)

    // Enter exits block-select mode
    await page.keyboard.press("Enter")
    await expect(editor.content.locator(".block--focused")).toHaveCount(0)

    expect(await editor.locator.evaluate(el => el.hasBlockSelection)).toBe(false)
  })

  test("block-handles attribute shows/hides drag handles", async ({ editor, page }) => {
    await editor.setValue("<p>Hover target</p>")

    // Default: handles enabled
    const block = editor.content.locator("p")
    const box = await block.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(200)

    const handle = page.locator("lexxy-editor .lexxy-block-handle")
    await expect(handle).toBeAttached()

    // Disable handles
    await editor.locator.evaluate(el => el.setAttribute("block-handles", "false"))
    await page.waitForTimeout(100)

    // Handle element should be removed
    await expect(handle).not.toBeAttached({ timeout: 2000 })

    // Re-enable handles
    await editor.locator.evaluate(el => el.setAttribute("block-handles", "true"))
    await page.waitForTimeout(100)

    // Hover again — handle should reappear
    await page.mouse.move(0, 0)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator("lexxy-editor .lexxy-block-handle")).toBeAttached({ timeout: 2000 })
  })

  test("block-handles=false at creation time hides handles", async ({ page }) => {
    // Navigate to a page and create an editor with block-handles=false
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")

    await page.evaluate(() => {
      const editor = document.querySelector("lexxy-editor")
      editor.setAttribute("block-handles", "false")
    })
    await page.waitForTimeout(100)

    const handle = page.locator("lexxy-editor .lexxy-block-handle")
    await expect(handle).not.toBeAttached()
  })
})
