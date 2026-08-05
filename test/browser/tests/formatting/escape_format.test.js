import { test } from "../../test_helper.js"
import { expect } from "@playwright/test"
import { assertEditorHtml, assertEditorContent } from "../../helpers/assertions.js"
import { clickToolbarButton } from "../../helpers/toolbar.js"

test.describe("Escape format", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
    await page.waitForSelector("lexxy-toolbar[connected]")
  })

  test("escape from blockquote with list at end", async ({ page, editor }) => {
    await editor.send("First line")
    await editor.selectAll()

    await page.getByRole("button", { name: "Bullet list" }).click()
    await assertEditorHtml(editor, "<ul><li value=\"1\">First line</li></ul>")

    await clickToolbarButton(page, "insertQuoteBlock")
    await assertEditorHtml(
      editor,
      "<ul><li value=\"1\"><blockquote><p>First line</p></blockquote></li></ul>",
    )

    await editor.send("ArrowRight")
    await editor.send("Enter", "Enter", "Enter")

    await editor.send("Outside quote")

    await assertEditorHtml(
      editor,
      "<ul><li value=\"1\"><blockquote>First line</blockquote></li></ul><p><br></p><p>Outside quote</p>",
    )
  })

  test("split blockquote when escaping from middle", async ({
    page,
    editor,
  }) => {
    await editor.send("First paragraph")
    await editor.send("Enter")
    await editor.send("Second paragraph")
    await editor.send("Enter")
    await editor.send("Third paragraph")
    await editor.selectAll()
    await clickToolbarButton(page, "insertQuoteBlock")

    await editor.select("Second paragraph")
    await editor.send("ArrowRight")

    await editor.send("Enter", "Enter")

    await editor.send("Middle content")

    await assertEditorHtml(
      editor,
      "<blockquote><p>First paragraph</p><p>Second paragraph</p></blockquote><p>Middle content</p><blockquote><p>Third paragraph</p></blockquote>",
    )
  })

  test("split blockquote when escaping from middle of list", async ({
    page,
    editor,
  }) => {
    await editor.send("Item one")
    await editor.send("Enter")
    await editor.send("Item two")
    await editor.send("Enter")
    await editor.send("Item three")
    await editor.selectAll()
    await page.getByRole("button", { name: "Bullet list" }).click()

    await clickToolbarButton(page, "insertQuoteBlock")
    await assertEditorHtml(
      editor,
      "<ul><li value=\"1\"><blockquote>Item one</blockquote></li><li value=\"2\">Item two</li><li value=\"3\">Item three</li></ul>",
    )

    await editor.select("Item two")
    await editor.send("ArrowRight")

    await editor.send("Enter", "Enter")

    await editor.send("Middle text")

    await assertEditorHtml(
      editor,
      "<ul><li value=\"1\"><blockquote>Item one</blockquote></li><li value=\"2\">Item two</li></ul><p>Middle text</p><ul><li value=\"1\">Item three</li></ul>",
    )
  })

  test("escape without splitting when all nodes after are empty", async ({
    page,
    editor,
  }) => {
    await editor.send("Item one")
    await editor.selectAll()
    await page.getByRole("button", { name: "Bullet list" }).click()

    await clickToolbarButton(page, "insertQuoteBlock")
    await assertEditorHtml(
      editor,
      "<ul><li value=\"1\"><blockquote><p>Item one</p></blockquote></li></ul>",
    )

    await editor.send("ArrowRight")
    await editor.send("Enter", "Enter", "Enter")

    await editor.send("After escape")

    await assertEditorHtml(
      editor,
      "<ul><li value=\"1\"><blockquote>Item one</blockquote></li></ul><p><br></p><p>After escape</p>",
    )
  })

  test("exit code block by pressing Enter on empty last line", async ({ page, editor }) => {
    await editor.setValue("<pre><code>line one</code></pre>")
    await editor.click()

    await editor.send("End")
    await editor.send("Enter")
    await editor.send("Enter")

    await editor.send("outside text")

    await assertEditorContent(editor, async (content) => {
      await expect(content.locator("code")).toContainText("line one")
      await expect(content.locator("p")).toContainText("outside text")
    })
  })

  test("exit code block with ArrowDown when code block is last element", async ({ page, editor }) => {
    await editor.setValue("<pre><code>some code</code></pre>")
    await editor.click()

    await editor.send("End")
    await editor.send("ArrowDown")

    await editor.send("after code")

    await assertEditorContent(editor, async (content) => {
      await expect(content.locator("code")).toContainText("some code")
      await expect(content.locator("p")).toContainText("after code")
    })
  })
})
