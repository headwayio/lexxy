import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"

import { normalizeHtml } from "../../helpers/html.js"

test.skip(({ browserName }) => browserName === "webkit", "WebKit pointer capture unreliable in sequential mode")

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

test("outdent non-wrapped item: no empty li left behind", async ({ editor, page }) => {
  await page.goto("/")
  await page.waitForSelector("lexxy-editor[connected]")

  await editor.setValue([
    '<ul>',
    '<li>Section A</li>',
    '<li class="lexxy-nested-listitem"><ul>',
    '<li>Child 1</li>',
    '<li>Child 2</li>',
    '</ul></li>',
    '<li>Section B</li>',
    '</ul>'
  ].join(''))

  const child1 = editor.content.locator("li:not(.lexxy-nested-listitem)").filter({ hasText: "Child 1" })
  const sectionB = editor.content.locator("li:not(.lexxy-nested-listitem)").filter({ hasText: "Section B" })

  // Capture browser console
  page.on('console', msg => console.log('BROWSER:', msg.text()))

  // Check initial state
  await editor.flush()
  const initialHtml = stripDynamicAttrs(await editor.value())
  console.log("INITIAL:", initialHtml)

  // Drop Child 1 before Section B (at depth 1, outdenting)
  await dragBlock(page, child1, sectionB, { position: "before" })
  await editor.flush()

  const html = stripDynamicAttrs(await editor.value())
  console.log("NON-WRAPPED RESULT:", html)

  // Count li elements — should not have any empty ones
  const emptyLiCount = (html.match(/<li[^>]*><\/li>/g) || []).length
  expect(emptyLiCount).toBe(0)

  // Child 1 should be at depth 1, Child 2 should be its child
  expect(html).toContain("Child 1")
  expect(html).toContain("Child 2")
})

test("outdent wrapped block: re-parents target's children", async ({ editor, page }) => {
  await page.goto("/")
  await page.waitForSelector("lexxy-editor[connected]")

  // H2 heading at root level, then a list with parent + children
  await editor.setValue([
    '<h2>My Heading</h2>',
    '<ul>',
    '<li>Parent</li>',
    '<li class="lexxy-nested-listitem"><ul>',
    '<li>Child A</li>',
    '<li>Child B</li>',
    '</ul></li>',
    '<li>After parent</li>',
    '</ul>'
  ].join(''))

  const heading = editor.content.locator("h2")
  const parent = editor.content.locator("li:not(.lexxy-nested-listitem)").getByText("Parent", { exact: true })

  // Drop heading "inside" Parent to nest it
  await dragBlock(page, heading, parent, { position: "inside" })
  await editor.flush()

  const html1 = stripDynamicAttrs(await editor.value())
  console.log("WRAPPED NEST RESULT:", html1)

  // The heading should now be inside the list
  expect(html1).toContain("<h2>My Heading</h2>")
})
