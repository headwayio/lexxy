import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { normalizeHtml } from "../../helpers/html.js"

function stripDynamicAttrs(html) {
  return html
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
}

async function dragBlock(page, sourceLocator, targetLocator, { position = "after" } = {}) {
  const sourceBox = await sourceLocator.boundingBox()
  const targetBox = await targetLocator.boundingBox()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.waitForTimeout(150)
  const handle = page.locator("lexxy-editor .lexxy-block-handle--visible")
  await expect(handle).toBeVisible({ timeout: 2000 })
  const handleBox = await handle.boundingBox()
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x, handleBox.y + 10, { steps: 3 })
  let targetY
  if (position === "before") targetY = targetBox.y + 2
  else if (position === "inside") targetY = targetBox.y + targetBox.height / 2
  else targetY = targetBox.y + targetBox.height - 2
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetY, { steps: 5 })
  await page.waitForTimeout(50)
  await page.mouse.up()
  await page.waitForTimeout(200)
}

test("drag child with grandchildren to after parent (outdent + re-parent)", async ({ editor, page }) => {
  test.setTimeout(10000) // short timeout to catch hangs quickly
  await page.goto("/")
  await page.waitForSelector("lexxy-editor[connected]")

  // Exact structure from the screenshot:
  // Section A > Child 1, Child 2 > Grandchild 1, Grandchild 2
  await editor.setValue([
    '<ul>',
    '<li>Section A</li>',
    '<li class="lexxy-nested-listitem"><ul>',
    '<li>Child 1 of Section A</li>',
    '<li>Child 2 of Section A</li>',
    '<li class="lexxy-nested-listitem"><ul>',
    '<li>Grandchild 1</li>',
    '<li>Grandchild 2</li>',
    '</ul></li>',
    '</ul></li>',
    '<li>Section B</li>',
    '</ul>'
  ].join(''))

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text())
  })

  const child2 = editor.content.locator("li:not(.lexxy-nested-listitem)").filter({ hasText: "Child 2 of Section A" })
  const sectionA = editor.content.locator("li:not(.lexxy-nested-listitem)").getByText("Section A", { exact: true })

  // Drop DIRECTLY after Section A — the item is inside Section A's wrapper
  await dragBlock(page, child2, sectionA, { position: "after" })
  await editor.flush()

  const html = stripDynamicAttrs(await editor.value())
  console.log("RESULT:", html)

  expect(html).toContain("Child 2 of Section A")
  expect(html).toContain("Grandchild 1")
  expect(html).toContain("Section A")
})
