import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"

test.describe("Drop edge cases", () => {
  test.skip(({ browserName }) => browserName === "webkit",
    "WebKit pointer capture unreliable in Playwright sequential mode")

  test("drag wrapped H2 out of list when list is first element in document", async ({ editor, page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")

    // List is the FIRST element — nothing above it
    await editor.setValue([
      '<ul>',
      '<li>First item</li>',
      '<li><h2>My Heading</h2></li>',
      '<li>Last item</li>',
      '</ul>'
    ].join(''))

    const h2Li = editor.content.locator("li:has(> h2)")

    // Hover over the H2 to get its handle
    const h2Box = await h2Li.boundingBox()
    await page.mouse.move(h2Box.x + h2Box.width / 2, h2Box.y + h2Box.height / 2)
    await page.waitForTimeout(150)

    const handle = page.locator("lexxy-editor .lexxy-block-handle--visible")
    await expect(handle).toBeVisible({ timeout: 2000 })
    const handleBox = await handle.boundingBox()

    // Start drag
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x, handleBox.y + 10, { steps: 3 })

    // Move to the very top of the editor (above the list)
    const editorRect = await editor.content.boundingBox()
    await page.mouse.move(editorRect.x + editorRect.width / 2, editorRect.y + 5, { steps: 10 })
    await page.waitForTimeout(100)

    await page.mouse.up()
    await page.waitForTimeout(200)
    await editor.flush()

    const result = await editor.value()

    // The H2 should be at root level, before the list
    expect(result).toContain("<h2>My Heading</h2>")
    const h2Idx = result.indexOf("<h2>")
    const ulIdx = result.indexOf("<ul>")
    expect(h2Idx).toBeLessThan(ulIdx)
  })
})
