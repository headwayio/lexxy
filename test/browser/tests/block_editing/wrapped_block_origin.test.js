import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { assertBlockHtml } from "../../helpers/assertions.js"

const modifier = process.platform === "darwin" ? "Meta" : "Control"

// Open the Cmd+/ menu and pick the "Bullet list" option from the Turn into submenu.
// TURN_INTO_OPTIONS order: Text, Heading 2, Heading 3, Heading 4, Bullet list, ...
// → from the open submenu (focused on Text), 4 ArrowDown presses lands on Bullet.
async function turnIntoBulletList(page) {
  await page.keyboard.press(`${modifier}+/`)
  const menu = page.locator("lexxy-block-actions")
  await expect(menu).toBeVisible({ timeout: 2000 })

  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")

  await expect(menu).toBeHidden({ timeout: 2000 })
}

test.describe("Wrapped block origin: user vs movement", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("user-wrapped heading stays wrapped after Cmd+Shift+Down moves it past a sibling", async ({ editor, page }) => {
    // Set up a heading and a paragraph below it, then user-wrap the heading by
    // turning it into a bullet list — the result is <ul><li><h2>...</h2></li></ul>.
    await editor.setValue("<h2>User heading</h2><p>Below</p>")
    await editor.select("User heading")
    await page.keyboard.press("Escape")

    await turnIntoBulletList(page)

    // Confirm the user-wrapped shape.
    await assertBlockHtml(editor, "<ul><li><h2>User heading</h2></li></ul><p>Below</p>")

    // Move the wrapped heading down past the "Below" paragraph. User-wrapped
    // items stay wrapped — they get a new root-level list to live in.
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)

    await assertBlockHtml(editor, "<p>Below</p><ul><li><h2>User heading</h2></li></ul>")
  })

  test("movement-wrapped heading auto-unwraps when arrowed back past the list", async ({ editor, page }) => {
    // A standalone heading directly above an existing list. The user
    // arrow-moves it down — it drifts into the list as a movement-wrapped
    // item nested under "Target". Then a second Cmd+Shift+ArrowDown
    // promotes it one level (sibling of Target). A third exits past the
    // bottom of the list. Because origin is "movement", on exit it must
    // extract back to a standalone heading rather than become a wrapped
    // sibling list — the user wants their pre-drift shape back.
    await editor.setValue("<h2>Drift heading</h2><ul><li>Target</li></ul>")
    await editor.select("Drift heading")
    await page.keyboard.press("Escape")

    // Drift in
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    // Promote out of nested list
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    // Exit past the bottom
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)

    await assertBlockHtml(editor, "<ul><li>Target</li></ul><h2>Drift heading</h2>")
  })

  test("user-wrapped origin survives deep nesting and exit", async ({ editor, page }) => {
    // Wrap a heading via Turn into Bullet (user-origin), nest it deeper
    // under an existing list item, then exit past the list. User-origin
    // must persist — the heading should still be wrapped on exit, never
    // demoted to standalone.
    await editor.setValue("<ul><li>Parent</li></ul><h2>User heading</h2>")
    await editor.select("User heading")
    await page.keyboard.press("Escape")

    await turnIntoBulletList(page)

    // Move up — heading joins the existing parent list as a wrapped sibling.
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`)
    // Move up again — nests under "Parent" via the depth-first entry rule.
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`)

    // Now bring it back down all the way out: 1 promote, 1 sibling-of-Parent,
    // 1 exit past the list.
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)

    // Final shape: heading is standalone-wrapped in its own root-level list,
    // below the original list with "Parent". The exact intermediate states
    // don't matter — what matters is the heading is still wrapped, NOT a
    // bare standalone <h2>.
    const finalHtml = stripDynamicAttrs(normalizeHtml(await editor.value()))
    expect(finalHtml).toContain("<h2>User heading</h2>")
    // Wrapped: heading lives inside <li> inside <ul>.
    expect(finalHtml).toMatch(/<ul>[^]*<li[^>]*>[^]*<h2>User heading<\/h2>[^]*<\/li>[^]*<\/ul>/)
  })

  test("Shift+Tab on a user-wrapped item at root unwraps it to standalone", async ({ editor, page }) => {
    // Even user-wrapped items unwrap via Shift+Tab — only arrow-movement
    // boundary exit differentiates user from movement origin.
    await editor.setValue("<h2>User heading</h2>")
    await editor.select("User heading")
    await page.keyboard.press("Escape")

    await turnIntoBulletList(page)
    await assertBlockHtml(editor, "<ul><li><h2>User heading</h2></li></ul>")

    await page.keyboard.press("Shift+Tab")
    await assertBlockHtml(editor, "<h2>User heading</h2>")
  })

  test("Shift+Tab on a movement-wrapped item at root depth unwraps it to standalone", async ({ editor, page }) => {
    // Drift in, promote one level so the item lives at root depth of its
    // list, then Shift+Tab to outdent. Behavior parity with user-wrapped:
    // both origins unwrap via Shift+Tab — only arrow-movement differs.
    await editor.setValue("<h2>Drift heading</h2><ul><li>Target</li></ul>")
    await editor.select("Drift heading")
    await page.keyboard.press("Escape")

    // Drift into the list.
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    // Promote one level — heading is now a sibling of Target.
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    // Shift+Tab outdents to standalone.
    await page.keyboard.press("Shift+Tab")

    const finalHtml = stripDynamicAttrs(normalizeHtml(await editor.value()))
    // Heading should be standalone (not wrapped in a li).
    expect(finalHtml).toMatch(/<h2>Drift heading<\/h2>/)
    expect(finalHtml).not.toMatch(/<li[^>]*>\s*<h2>Drift heading/)
  })
})
