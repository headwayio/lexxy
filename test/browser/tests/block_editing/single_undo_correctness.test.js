import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { normalizeHtml } from "../../helpers/html.js"

function stripDynamicAttrs(html) {
  return html
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
    .replace(/\s*data-block-movement-wrapped="[^"]*"/g, "")
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

// Open the Cmd+/ menu and pick a Turn into option by index in TURN_INTO_OPTIONS
// (Text=0, Heading 2=1, Heading 3=2, Heading 4=3, Bullet=4, Numbered=5, Quote=6, Code=7).
async function openMenuAndTurnIntoIndex(page, submenuIndex) {
  await page.keyboard.press(`${modifier}+/`)
  const menu = page.locator("lexxy-block-actions")
  await expect(menu).toBeVisible({ timeout: 2000 })

  await page.keyboard.press("ArrowRight") // open Turn into submenu, focus first item (Text)
  for (let i = 0; i < submenuIndex; i++) {
    await page.keyboard.press("ArrowDown")
  }
  await page.keyboard.press("Enter")
  await expect(menu).toBeHidden({ timeout: 2000 })
}

test.describe("Block-editing actions: single-press Cmd+Z reverts to pre-action state", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("one Cmd+Z after multi-block Turn into Bullet reverts the full pre-action shape", async ({ editor, page }) => {
    // Regression guard for commit 55632e18 (HISTORY_PUSH_TAG fix) and
    // commit b29532f0 (provisional-paragraph mark-dirty merge): both bugs
    // caused multi-block Turn into to require two Cmd+Z presses.
    const original = "<h2>A</h2><blockquote><p>B</p></blockquote><p>After</p>"
    await editor.setValue(original)
    await editor.select("A")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown") // extend selection to include blockquote

    await openMenuAndTurnIntoIndex(page, 4) // Bullet list

    // Confirm conversion happened.
    await assertBlockHtml(
      editor,
      "<ul><li><h2>A</h2></li><li><blockquote><p>B</p></blockquote></li></ul><p>After</p>"
    )

    await page.keyboard.press(`${modifier}+z`)

    await assertBlockHtml(editor, original)
  })

  test("one Cmd+Z after Remove Quote reverts to the blockquote shape", async ({ editor, page }) => {
    // Quote wrapping non-text content (HR) — Remove Quote is visible.
    // Text-only blockquotes don't show Remove Quote (use Turn into Text).
    const original = "<p>Before</p><blockquote><hr></blockquote><p>After</p>"
    await editor.setValue(original)
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus blockquote

    // Open menu, navigate: Turn into, Color, Remove Quote.
    await page.keyboard.press(`${modifier}+/`)
    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await page.keyboard.press("ArrowDown") // Color
    await page.keyboard.press("ArrowDown") // Remove Quote
    await page.keyboard.press("Enter")
    await expect(menu).toBeHidden({ timeout: 2000 })

    // HR peeled to root.
    await assertBlockHtml(editor, "<p>Before</p><hr><p>After</p>")

    await page.keyboard.press(`${modifier}+z`)

    await assertBlockHtml(editor, original)
  })

  test("one Cmd+Z after Remove Bullet reverts to the wrapped-list shape", async ({ editor, page }) => {
    // Bullet wrapping HR — Remove Bullet visible (unwrapListType = "bullet").
    const original = "<p>Before</p><ul><li><hr></li></ul><p>After</p>"
    await editor.setValue(original)
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus wrapped HR (li)

    // Open menu, navigate: Turn into, Color, Remove Bullet.
    await page.keyboard.press(`${modifier}+/`)
    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await page.keyboard.press("ArrowDown") // Color
    await page.keyboard.press("ArrowDown") // Remove Bullet
    await page.keyboard.press("Enter")
    await expect(menu).toBeHidden({ timeout: 2000 })

    // HR peeled to root.
    await assertBlockHtml(editor, "<p>Before</p><hr><p>After</p>")

    await page.keyboard.press(`${modifier}+z`)

    await assertBlockHtml(editor, original)
  })

  test("one Cmd+Z after multi-block group move reverts to pre-move shape", async ({ editor, page }) => {
    // Multi-block move via Cmd+Shift+ArrowDown should be a single undo step.
    const original = "<p>A</p><p>B</p><p>C</p>"
    await editor.setValue(original)
    await editor.select("A")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown") // extend to include B
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`) // move A+B down past C

    await assertBlockHtml(editor, "<p>C</p><p>A</p><p>B</p>")

    await page.keyboard.press(`${modifier}+z`)

    await assertBlockHtml(editor, original)
  })
})
