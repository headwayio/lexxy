import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"

test.describe("Drop debug", () => {
  test.skip(({ browserName }) => browserName === "webkit",
    "WebKit pointer capture unreliable in Playwright sequential mode")

  test("drag grandchild to before Section B at depth 1", async ({ editor, page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")

    await editor.setValue([
      '<ul>',
      '<li>Section A</li>',
      '<li class="lexxy-nested-listitem"><ul>',
      '<li>Child 1</li>',
      '<li class="lexxy-nested-listitem"><ul><li>Grandchild 2</li></ul></li>',
      '<li>Child 2</li>',
      '<li class="lexxy-nested-listitem"><ul><li>Grandchild 1</li></ul></li>',
      '</ul></li>',
      '<li>Section B</li>',
      '</ul>'
    ].join(''))

    const gc2 = editor.content.locator("li:not(.lexxy-nested-listitem)").filter({ hasText: "Grandchild 2" })
    const sectionB = editor.content.locator("li:not(.lexxy-nested-listitem)").filter({ hasText: "Section B" })

    const gc2Box = await gc2.boundingBox()
    await page.mouse.move(gc2Box.x + gc2Box.width / 2, gc2Box.y + gc2Box.height / 2)
    await page.waitForTimeout(150)

    const handle = page.locator("lexxy-editor .lexxy-block-handle--visible")
    await expect(handle).toBeVisible({ timeout: 2000 })
    const handleBox = await handle.boundingBox()

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x, handleBox.y + 10, { steps: 3 })

    const sbBox = await sectionB.boundingBox()
    await page.mouse.move(sbBox.x + sbBox.width / 2, sbBox.y + 2, { steps: 10 })
    await page.waitForTimeout(100)

    await expect(page.locator(".lexxy-drop-indicator--visible")).toBeVisible()
    await page.mouse.up()
    await page.waitForTimeout(200)
    await editor.flush()

    const result = await editor.value()
    expect(result).toContain("Grandchild 2")
    const gc2Idx = result.indexOf("Grandchild 2")
    const sbIdx = result.indexOf("Section B")
    expect(gc2Idx).toBeLessThan(sbIdx)
  })

  test("drag wrapped H3 to nest inside a list item", async ({ editor, page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")

    await editor.setValue([
      '<ul>',
      '<li>Section E</li>',
      '<li class="lexxy-nested-listitem"><ul>',
      '<li>Item above</li>',
      '<li><h3>Adjacent H3 heading</h3></li>',
      '<li>Item below</li>',
      '</ul></li>',
      '</ul>',
      '<p>Padding 1</p>'
    ].join(''))

    const h3Li = editor.content.locator("li:has(> h3)")
    const itemAbove = editor.content.locator("li:not(.lexxy-nested-listitem)").filter({ hasText: "Item above" })

    const h3Box = await h3Li.boundingBox()
    await page.mouse.move(h3Box.x + h3Box.width / 2, h3Box.y + h3Box.height / 2)
    await page.waitForTimeout(150)

    const handle = page.locator("lexxy-editor .lexxy-block-handle--visible")
    await expect(handle).toBeVisible({ timeout: 2000 })
    const handleBox = await handle.boundingBox()

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x, handleBox.y + 10, { steps: 3 })

    const targetBox = await itemAbove.boundingBox()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 })
    await page.waitForTimeout(100)

    await page.mouse.up()
    await page.waitForTimeout(200)
    await editor.flush()

    const result = await editor.value()
    expect(result).toContain("Adjacent H3 heading")
    expect(result).toContain("Item above")
  })

  test("drag wrapped H3 to root level after list", async ({ editor, page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")

    await editor.setValue([
      '<ul>',
      '<li>Section E</li>',
      '<li class="lexxy-nested-listitem"><ul>',
      '<li>Item above</li>',
      '<li><h3>Adjacent H3 heading</h3></li>',
      '<li>Item below</li>',
      '</ul></li>',
      '</ul>',
      '<p>Padding 1</p>'
    ].join(''))

    const h3Li = editor.content.locator("li:has(> h3)")
    const padding = editor.content.locator("p").filter({ hasText: "Padding 1" })

    const h3Box = await h3Li.boundingBox()
    await page.mouse.move(h3Box.x + h3Box.width / 2, h3Box.y + h3Box.height / 2)
    await page.waitForTimeout(150)

    const handle = page.locator("lexxy-editor .lexxy-block-handle--visible")
    await expect(handle).toBeVisible({ timeout: 2000 })
    const handleBox = await handle.boundingBox()

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x, handleBox.y + 10, { steps: 3 })

    const targetBox = await padding.boundingBox()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, { steps: 10 })
    await page.waitForTimeout(100)

    await expect(page.locator(".lexxy-drop-indicator--visible")).toBeVisible()
    await page.mouse.up()
    await page.waitForTimeout(200)
    await editor.flush()

    const result = await editor.value()
    expect(result).toContain("<h3>Adjacent H3 heading</h3>")
    const h3Idx = result.indexOf("Adjacent H3 heading")
    const padIdx = result.indexOf("Padding 1")
    expect(h3Idx).toBeGreaterThan(padIdx)
  })
})
