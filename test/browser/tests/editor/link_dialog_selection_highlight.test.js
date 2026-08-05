import { test } from "../../test_helper.js"
import { expect } from "@playwright/test"

// Opening the link dialog moves focus into the URL field, so the browser stops
// painting the text selection and the user can no longer see what they are
// about to link. The dropdown re-draws it as overlay rectangles. This has been
// lost in a rebase once already, hence the regression guard.
test.describe("Link dialog selection highlight", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
    await page.waitForSelector("lexxy-toolbar[connected]")
  })

  const overlays = (page) => page.locator(".lexxy-link-selection-overlay")

  test("draws an overlay over the selected text while the dialog is open", async ({ page, editor }) => {
    await editor.setValue("<p>Hello brave new world</p>")
    await editor.select("brave new")

    await expect(overlays(page)).toHaveCount(0)

    await page.locator("lexxy-toolbar button[name='link']").click()
    await expect(overlays(page)).toHaveCount(1)

    // The overlay must actually cover the selected words, not collapse to zero.
    const box = await overlays(page).first().boundingBox()
    expect(box.width).toBeGreaterThan(10)
    expect(box.height).toBeGreaterThan(5)

    // ...and the URL field owns focus, which is why the highlight is needed.
    await expect(page.locator("lexxy-link-dropdown input[type='url']")).toBeFocused()
  })

  test("removes the overlay when the dialog closes", async ({ page, editor }) => {
    await editor.setValue("<p>Hello brave new world</p>")
    await editor.select("brave new")

    await page.locator("lexxy-toolbar button[name='link']").click()
    await expect(overlays(page)).toHaveCount(1)

    await page.keyboard.press("Escape")
    await expect(overlays(page)).toHaveCount(0)
  })

  test("does not leave overlays behind across repeated opens", async ({ page, editor }) => {
    await editor.setValue("<p>Hello brave new world</p>")

    for (let i = 0; i < 3; i++) {
      await editor.select("brave new")
      await page.locator("lexxy-toolbar button[name='link']").click()
      await expect(overlays(page)).toHaveCount(1)
      await page.keyboard.press("Escape")
      await expect(overlays(page)).toHaveCount(0)
    }
  })
})
