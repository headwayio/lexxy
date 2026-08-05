import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { stripDynamicAttrs } from "../../helpers/assertions.js"
import { dragBlock } from "../../helpers/drag.js"

test.describe("Drop freeze", () => {
  test.skip(({ browserName }) => browserName === "webkit",
    "WebKit pointer capture unreliable in Playwright sequential mode")

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
})
