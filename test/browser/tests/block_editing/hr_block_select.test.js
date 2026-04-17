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

// TURN_INTO_OPTIONS index: Text=0, Heading 2=1, Heading 3=2, Heading 4=3, Bullet=4, Numbered=5, Quote=6, Code=7.
async function openMenuAndTurnIntoIndex(page, submenuIndex) {
  await page.keyboard.press(`${modifier}+/`)
  const menu = page.locator("lexxy-block-actions")
  await expect(menu).toBeVisible({ timeout: 2000 })

  await page.keyboard.press("ArrowRight")
  for (let i = 0; i < submenuIndex; i++) {
    await page.keyboard.press("ArrowDown")
  }
  await page.keyboard.press("Enter")
  await expect(menu).toBeHidden({ timeout: 2000 })
}

test.describe("Horizontal divider in block-select mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("Turn into Bullet on a focused HR wraps it as a list item", async ({ editor, page }) => {
    // Decorator rule allows lists + quote — Bullet is enabled in the menu.
    await editor.setValue("<p>Before</p><hr><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus HR

    await openMenuAndTurnIntoIndex(page, 4) // Bullet list

    await assertBlockHtml(editor, "<p>Before</p><ul><li><hr></li></ul><p>After</p>")
  })

  test("Cmd+Shift+Down moves a wrapped HR past a sibling, preserving wrapping", async ({ editor, page }) => {
    await editor.setValue("<ul><li><hr></li></ul><p>Below</p>")
    await editor.select("Below")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowUp") // focus the wrapped HR (li)
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`) // move HR down past Below

    // Wrapped HR remains wrapped (user-origin from setValue fallback) but
    // lives in a new root-level <ul> below the paragraph.
    await assertBlockHtml(editor, "<p>Below</p><ul><li><hr></li></ul>")
  })

  test("Remove Bullet on a wrapped HR unwraps to root", async ({ editor, page }) => {
    // Specific check that the explicit Remove Bullet action on a wrapped HR
    // peels every layer back to the root (commit d9654ab3).
    await editor.setValue("<p>Before</p><ul><li><hr></li></ul><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus wrapped HR

    await page.keyboard.press(`${modifier}+/`)
    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    // Main panel: Turn into, Color, Remove Bullet, Duplicate, Delete.
    await page.keyboard.press("ArrowDown") // Color
    await page.keyboard.press("ArrowDown") // Remove Bullet
    await page.keyboard.press("Enter")
    await expect(menu).toBeHidden({ timeout: 2000 })

    await assertBlockHtml(editor, "<p>Before</p><hr><p>After</p>")
  })

  test("ArrowDown navigates over an HR decorator in block-select mode", async ({ editor, page }) => {
    // Block-select navigation must treat HR (a DecoratorNode) as a real
    // navigable block — pressing ArrowDown should land focus on it, then
    // continue past it on the next press.
    await editor.setValue("<p>Above</p><hr><p>Below</p>")
    await editor.select("Above")
    await page.keyboard.press("Escape")

    await page.keyboard.press("ArrowDown")
    // Focus should be on the HR. HorizontalDividerNode renders as
    // <figure class="horizontal-divider"><hr><...></figure> in the DOM.
    const focused = editor.content.locator(".block--focused")
    await expect(focused).toHaveCount(1)
    await expect(focused.locator("hr")).toHaveCount(1)

    await page.keyboard.press("ArrowDown")
    await expect(editor.content.locator(".block--focused")).toContainText("Below")
  })
})
