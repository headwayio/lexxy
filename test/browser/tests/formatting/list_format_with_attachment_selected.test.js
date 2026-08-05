import { test } from "../../test_helper.js"
import { expect } from "@playwright/test"

test.describe("List formatting with attachment selected", () => {
  const ATTACHMENT_HTML =
    '<action-text-attachment content-type="image/png" url="/test.png" filename="photo.png" width="100" height="100"></action-text-attachment>'

  test.beforeEach(async ({ page }) => {
    await page.goto("/attachments-enabled.html")
    await page.waitForSelector("lexxy-editor[connected]")
    await page.waitForSelector("lexxy-toolbar[connected]")

    // Hide the floating attachment-controls overlay: it appears on hover
    // and intercepts pointer events when Playwright tries to click the
    // attachment image, flaking differently across browsers. The test is
    // about Lexical's list-command behavior on a NodeSelection, not the
    // controls overlay.
    await page.addStyleTag({
      content: "lexxy-attachment-controls { display: none !important; }",
    })
  })

  test("bullet list does not crash when an attachment is selected", async ({ page, editor }) => {
    await editor.setValue(`<p>Hello</p>${ATTACHMENT_HTML}`)

    // Click the img to select the attachment (creating a NodeSelection)
    await editor.content.locator("figure.attachment img").click()
    await editor.flush()
    await expect(editor.content.locator("figure.node--selected")).toHaveCount(1)

    // Listen for errors -- the bug causes "Cannot read properties of undefined (reading 'getNode')"
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))

    // Click the bullet list button -- should not crash
    await page.getByRole("button", { name: "Bullet list" }).click()
    await page.waitForTimeout(500)

    // No JS errors should have been thrown
    expect(errors).toHaveLength(0)

    // The paragraph and attachment should still be present (command was a no-op)
    await expect(editor.content).toContainText("Hello")
    await expect(editor.content.locator("figure.attachment")).toHaveCount(1)
  })

  test("numbered list does not crash when an attachment is selected", async ({ page, editor }) => {
    await editor.setValue(`<p>Hello</p>${ATTACHMENT_HTML}`)

    // Click the img to select the attachment (creating a NodeSelection)
    await editor.content.locator("figure.attachment img").click()
    await editor.flush()
    await expect(editor.content.locator("figure.node--selected")).toHaveCount(1)

    // Listen for errors
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))

    // Click the numbered list button -- should not crash
    await page.getByRole("button", { name: "Numbered list" }).click()
    await page.waitForTimeout(500)

    // No JS errors should have been thrown
    expect(errors).toHaveLength(0)

    // The paragraph and attachment should still be present (command was a no-op)
    await expect(editor.content).toContainText("Hello")
    await expect(editor.content.locator("figure.attachment")).toHaveCount(1)
  })
})
