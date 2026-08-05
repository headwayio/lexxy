import { test } from "../../test_helper.js"
import { EditorHandle } from "../../helpers/editor_handle.js"
import { expect } from "@playwright/test"

// Typing "/" over a highlighted range must keep the text, open the palette
// (bypassing the start-of-word gate), and apply the picked command to exactly
// that range instead of the whole block.
test.describe("Slash commands over a selection", () => {
  let editor, popover

  test.beforeEach(async ({ page }) => {
    await page.goto("/index.html")
    editor = new EditorHandle(page, "lexxy-editor")
    await editor.waitForConnected()
    popover = page.locator(".lexxy-prompt-menu--visible")
  })

  test("typing / over a selection keeps the text and opens the menu", async ({ page }) => {
    await editor.send("What is up dawg")
    await editor.select("dawg")
    await editor.send("/")

    await expect(popover).toBeVisible({ timeout: 5_000 })
    expect(await editor.plainTextValue()).toContain("What is up dawg/")
  })

  test("a color item styles exactly the highlighted text", async ({ page }) => {
    await editor.send("What is up dawg")
    await editor.select("dawg")
    await editor.send("/")
    await expect(popover).toBeVisible({ timeout: 5_000 })

    await editor.send("red text")
    const item = popover.locator("[aria-selected]", { hasText: "Red text" })
    await expect(item).toBeVisible({ timeout: 5_000 })
    await editor.send("Enter")

    await expect
      .poll(async () => editor.value(), { timeout: 5_000 })
      .toMatch(/What is up <mark[^>]*>dawg<\/mark>/)
    expect(await editor.value()).toContain("var(--highlight-3)")
  })

  test("a color item without a selection still styles the whole block", async ({ page }) => {
    await editor.send("Hello world ")
    await editor.send("/")
    await expect(popover).toBeVisible({ timeout: 5_000 })

    await editor.send("red text")
    const item = popover.locator("[aria-selected]", { hasText: "Red text" })
    await expect(item).toBeVisible({ timeout: 5_000 })
    await editor.send("Enter")

    await expect
      .poll(async () => editor.value(), { timeout: 5_000 })
      .toMatch(/<mark[^>]*>Hello world\s*<\/mark>/)
  })

  test("a color item styles a highlighted word inside a list item", async ({ page }) => {
    await editor.setValue(`
      <ul>
        <li>Things</li>
        <li>Do you know?<pre data-language="ruby">Code is good</pre></li>
        <li>What is up dawg?</li>
      </ul>
    `)
    await editor.select("dawg")
    await editor.send("/")
    await expect(popover).toBeVisible({ timeout: 5_000 })

    await editor.send("red text")
    const item = popover.locator("[aria-selected]", { hasText: "Red text" })
    await expect(item).toBeVisible({ timeout: 5_000 })
    await editor.send("Enter")

    await expect
      .poll(async () => editor.value(), { timeout: 5_000 })
      .toMatch(/What is up <mark[^>]*>dawg<\/mark>/)
  })
})
