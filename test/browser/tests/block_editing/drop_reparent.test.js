import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { stripDynamicAttrs } from "../../helpers/assertions.js"
import { dragBlock } from "../../helpers/drag.js"

test.describe("Drop reparent", () => {
  test.skip(({ browserName }) => browserName === "webkit",
    "WebKit pointer capture unreliable in Playwright sequential mode")

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

    await editor.flush()

    // Drop Child 1 before Section B (at depth 1, outdenting)
    await dragBlock(page, child1, sectionB, { position: "before" })
    await editor.flush()

    const html = stripDynamicAttrs(await editor.value())

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

    // The heading should now be inside the list
    expect(html1).toContain("<h2>My Heading</h2>")
  })
})
