import { test } from "../test_helper.js"
import { expect } from "@playwright/test"
import { assertEditorContent } from "../helpers/assertions.js"

test.describe("Bug: Pasted @mentions broken", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("pasting Trix mention HTML renders the mention without errors", async ({ page, editor }) => {
    // Trix/ActionText stores mention content as raw HTML in the content attribute.
    // Lexxy's importDOM incorrectly calls JSON.parse on this value, causing a crash.
    const mentionHtml = [
      '<action-text-attachment',
      ' content-type="application/vnd.actiontext.mention"',
      ' sgid="test-sgid-123"',
      ' content="&lt;span class=&quot;person person--inline&quot;&gt;&lt;img src=&quot;/avatar.png&quot; class=&quot;person--avatar&quot; alt=&quot;&quot;&gt;&lt;span class=&quot;person--name&quot;&gt;Michael Berger&lt;/span&gt;&lt;/span&gt;"',
      '>Michael Berger</action-text-attachment>'
    ].join("")

    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))

    await editor.paste("Michael Berger", { html: mentionHtml })
    await page.waitForTimeout(500)

    // The paste must not throw a JSON parse error
    expect(errors).toHaveLength(0)

    // The mention should be rendered as a custom attachment
    await assertEditorContent(editor, async (content) => {
      await expect(content.locator("action-text-attachment")).toHaveCount(1)
    })
  })
})
