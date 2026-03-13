import { test } from "../test_helper.js"
import { expect } from "@playwright/test"
import { assertEditorHtml } from "../helpers/assertions.js"

test.describe("Bug: Undo after code formatting", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
    await page.waitForSelector("lexxy-toolbar[connected]")
  })

  test("can undo inline code formatting with Ctrl+Z", async ({ page, editor }) => {
    await editor.send("Hello world")
    await editor.flush()

    await editor.select("Hello world")
    await editor.flush()

    await page.getByRole("button", { name: "Code" }).click()
    await assertEditorHtml(editor, "<p><code>Hello world</code></p>")

    await editor.send("Control+z")

    await assertEditorHtml(editor, "<p>Hello world</p>")
  })

  test("can undo inline code formatting on partial selection", async ({ page, editor }) => {
    await editor.send("Hello world")
    await editor.flush()

    await editor.select("world")
    await editor.flush()

    await page.getByRole("button", { name: "Code" }).click()
    await assertEditorHtml(editor, "<p>Hello <code>world</code></p>")

    await editor.send("Control+z")

    await assertEditorHtml(editor, "<p>Hello world</p>")
  })

  test("can undo code block formatting with Ctrl+Z", async ({ page, editor }) => {
    await editor.send("Hello world")
    await editor.flush()

    // Click Code without a word selection to get a code block
    await editor.click()
    await editor.flush()

    await page.getByRole("button", { name: "Code" }).click()
    await assertEditorHtml(
      editor,
      '<pre data-language="plain" data-highlight-language="plain">Hello world</pre>',
    )

    await editor.send("Control+z")

    await assertEditorHtml(editor, "<p>Hello world</p>")
  })
})
