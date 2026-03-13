import { expect } from "@playwright/test"
import { test } from "../test_helper.js"
import { assertEditorHtml } from "../helpers/assertions.js"

test.describe("Bug reproduction: code formatting can get stuck", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
    await page.waitForSelector("lexxy-toolbar[connected]")
  })

  test("v1: moving the caret out of inline code stops new typing from staying in code", async ({
    page,
    editor,
  }) => {
    await editor.setValue("<p>Hello <code>code</code></p>")

    const codeButton = page.getByRole("button", { name: "Code" })

    await editor.content.locator("code").click()
    await expect(codeButton).toHaveAttribute("aria-pressed", "true")

    await editor.content.evaluate((content) => {
      const code = content.querySelector("code")
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
      const textNode = walker.nextNode()
      const range = document.createRange()
      range.setStart(textNode, textNode.textContent.length)
      range.collapse(true)

      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })

    await editor.send("ArrowRight")
    await editor.send("!")

    await assertEditorHtml(editor, "<p>Hello <code>code</code>!</p>")
    await expect(codeButton).toHaveAttribute("aria-pressed", "false")
  })

  test("v2: clicking plain text after inline code clears the code toolbar state", async ({
    page,
    editor,
  }) => {
    await editor.setValue("<p>Hello <code>code</code> world</p>")

    const codeButton = page.getByRole("button", { name: "Code" })

    await editor.content.locator("code").click()
    await expect(codeButton).toHaveAttribute("aria-pressed", "true")

    await editor.content.getByText("world").click()

    await expect(codeButton).toHaveAttribute("aria-pressed", "false")
  })
})
