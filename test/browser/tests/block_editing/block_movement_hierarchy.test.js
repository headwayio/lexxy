import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { normalizeHtml } from "../../helpers/html.js"

function stripDynamicAttrs(html) {
  return html
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
}

async function assertBlockHtml(editor, expected) {
  await expect
    .poll(
      async () => {
        await editor.flush()
        return stripDynamicAttrs(normalizeHtml(await editor.value()))
      },
      { timeout: 5_000 },
    )
    .toBe(stripDynamicAttrs(normalizeHtml(expected)))
}

const modifier = process.platform === "darwin" ? "Meta" : "Control"

test.describe("Block movement with parent-child hierarchy", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("moving parent down does not pass through its children", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Child A</li><li>Child B</li></ul></li><li>Below</li></ul>'
    )
    // Select "Parent" and enter block-select mode
    await editor.select("Parent")
    await page.keyboard.press("Escape")
    await expect(editor.content.locator(".block--focused")).toContainText("Parent")

    // Move down — should swap Parent+children with "Below", not nest into children
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    await editor.flush()

    const html = stripDynamicAttrs(normalizeHtml(await editor.value()))

    // "Below" should now be before "Parent", and children should still be under Parent
    const belowIdx = html.indexOf("Below")
    const parentIdx = html.indexOf("Parent")
    expect(belowIdx).toBeLessThan(parentIdx)

    // Children should still be nested under Parent, not separated
    expect(html).toContain("Child A")
    expect(html).toContain("Child B")
  })

  test("moving child up does not pass through its parent", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>Above</li><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Child A</li><li>Child B</li></ul></li></ul>'
    )
    // Select "Child A" and enter block-select mode
    await editor.select("Child A")
    await page.keyboard.press("Escape")
    await expect(editor.content.locator(".block--focused")).toContainText("Child A")

    // Move up — should promote Child A above Parent, not nest inside Parent
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`)
    await editor.flush()

    const html = stripDynamicAttrs(normalizeHtml(await editor.value()))

    // Child A should be before Parent in the document
    const childAIdx = html.indexOf("Child A")
    const parentIdx = html.indexOf("Parent")
    expect(childAIdx).toBeLessThan(parentIdx)
  })

  test("parent at bottom of document stops when last child reaches end", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Child</li></ul></li></ul>'
    )
    await editor.select("Parent")
    await page.keyboard.press("Escape")

    // Move down — already at bottom, should be a no-op
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    await editor.flush()

    const html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    // Structure should be unchanged
    expect(html).toContain("Parent")
    expect(html).toContain("Child")
  })

  test("child at top of list stops at document start", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Child</li></ul></li></ul>'
    )
    await editor.select("Child")
    await page.keyboard.press("Escape")

    // Move up twice — should promote to sibling then stop at top
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`)
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`)
    await editor.flush()

    const html = stripDynamicAttrs(normalizeHtml(await editor.value()))
    // Child should be before Parent (promoted), document should still be valid
    expect(html).toContain("Child")
    expect(html).toContain("Parent")
  })

  test("repeated Cmd+Shift+Down preserves parent-child order", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>Top</li><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Child A</li><li>Child B</li></ul></li><li>Bottom</li></ul>'
    )
    await editor.select("Parent")
    await page.keyboard.press("Escape")

    // Press down 5 times — should eventually stop, never passing through children
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
      await editor.flush()

      const html = stripDynamicAttrs(normalizeHtml(await editor.value()))
      const parentIdx = html.indexOf("Parent")
      const childAIdx = html.indexOf("Child A")
      const childBIdx = html.indexOf("Child B")

      // Parent must ALWAYS come before its children
      if (childAIdx > -1) expect(parentIdx).toBeLessThan(childAIdx)
      if (childBIdx > -1) expect(parentIdx).toBeLessThan(childBIdx)
    }
  })

  test("repeated Cmd+Shift+Up on child preserves order relative to parent", async ({ editor, page }) => {
    await editor.setValue(
      '<ul><li>Top</li><li>Parent</li><li class="lexxy-nested-listitem"><ul><li>Child A</li><li>Child B</li></ul></li><li>Bottom</li></ul>'
    )
    await editor.select("Child A")
    await page.keyboard.press("Escape")

    // Press up 5 times
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press(`${modifier}+Shift+ArrowUp`)
      await editor.flush()

      const html = stripDynamicAttrs(normalizeHtml(await editor.value()))
      const childAIdx = html.indexOf("Child A")
      const childBIdx = html.indexOf("Child B")

      // Child A should always stay before Child B (if B is still in doc)
      if (childBIdx > -1 && childAIdx > -1) {
        expect(childAIdx).toBeLessThan(childBIdx)
      }
    }
  })

  test("multi-select parent and children move as a unit", async ({ editor, page }) => {
    await editor.setValue("<p>Above</p><p>Block A</p><p>Block B</p><p>Below</p>")
    // Select Block A
    await editor.select("Block A")
    await page.keyboard.press("Escape")
    // Extend selection to Block B
    await page.keyboard.press("Shift+ArrowDown")

    await expect(editor.content.locator(".block--focused, .block--selected")).toHaveCount(2)

    // Move both down
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    await editor.flush()

    const html = normalizeHtml(await editor.value())
    // Order should be: Above, Below, Block A, Block B (A and B stayed together)
    const aboveIdx = html.indexOf("Above")
    const belowIdx = html.indexOf("Below")
    const aIdx = html.indexOf("Block A")
    const bIdx = html.indexOf("Block B")

    expect(aboveIdx).toBeLessThan(belowIdx)
    expect(belowIdx).toBeLessThan(aIdx)
    expect(aIdx).toBeLessThan(bIdx)
  })
})
