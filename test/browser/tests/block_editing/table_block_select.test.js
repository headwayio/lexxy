import { expect } from "@playwright/test"
import { test } from "../../test_helper.js"
import { normalizeHtml } from "../../helpers/html.js"
import { stripDynamicAttrs } from "../../helpers/assertions.js"

const modifier = process.platform === "darwin" ? "Meta" : "Control"

const TABLE_HTML = '<figure class="lexxy-content__table-wrapper"><table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table></figure>'

// Open the Cmd+/ menu and pick a Turn into option by index in TURN_INTO_OPTIONS:
// Text=0, Heading 2=1, Heading 3=2, Heading 4=3, Bullet=4, Numbered=5, Quote=6, Code=7.
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

test.describe("Tables as wrappable blocks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("multi-block Turn into Bullet wraps a table; cells are preserved", async ({ editor, page }) => {
    // Single-block focus on a table disables every Turn into option in the
    // menu (table restriction). The wrap path runs through the multi-block
    // branch — focus on a non-restricted block (paragraph) and extend the
    // selection over the table. Commit fc4d137f narrowed the table skip
    // guard so list/quote commands now produce
    // <ul><li><figure><table>…</table></figure></li></ul> with cells intact.
    await editor.setValue(`<p>Lead</p>${TABLE_HTML}<p>Trail</p>`)
    await editor.select("Lead")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown") // extend over table
    await page.keyboard.press("Shift+ArrowDown") // extend to Trail (focus lands on paragraph)

    await openMenuAndTurnIntoIndex(page, 4) // Bullet list

    const html = stripDynamicAttrs(await editor.value())
    // Table cells are preserved inside the wrapped list item.
    expect(html).toContain("<table>")
    expect(html).toMatch(/<td>[^<]*<p>A<\/p>[^<]*<\/td>/)
    expect(html).toMatch(/<td>[^<]*<p>B<\/p>[^<]*<\/td>/)
    // Wrapped figure lives inside an li.
    expect(html).toMatch(/<li>[^]*<figure[^]*<table>/)
    // Lead and Trail paragraphs converted to plain bullets.
    expect(html).toContain("<li>Lead</li>")
    expect(html).toContain("<li>Trail</li>")
  })

  test("multi-block Turn into Quote wraps a table; cells are preserved", async ({ editor, page }) => {
    await editor.setValue(`<p>Lead</p>${TABLE_HTML}<p>Trail</p>`)
    await editor.select("Lead")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press("Shift+ArrowDown")

    await openMenuAndTurnIntoIndex(page, 6) // Quote

    const html = await editor.value()
    expect(html).toContain("<table>")
    expect(html).toMatch(/<td>[^<]*<p>A<\/p>[^<]*<\/td>/)
    expect(html).toMatch(/<td>[^<]*<p>B<\/p>[^<]*<\/td>/)
    expect(html).toMatch(/<blockquote>[^]*<figure[^]*<table>/)
  })

  test("Single-block menu on a table disables every Turn into option (regression guard)", async ({ editor, page }) => {
    // Single-block focus on a table → all Turn into commands disabled
    // because converting a standalone table to text/heading/code wipes its
    // cells. Multi-block path is the only way to wrap a table currently.
    await editor.setValue(`${TABLE_HTML}<p>After</p>`)
    await editor.select("A")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    const turnIntoItems = menu.locator("[data-action='turn-into']")
    const count = await turnIntoItems.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(turnIntoItems.nth(i)).toHaveAttribute("disabled", /.*/)
    }
  })

  test("Shift+Tab on a wrapped table at root unwraps to a standalone table", async ({ editor, page }) => {
    // Wrapped table at root: the in-place extract path (#extractWrappedItemsInPlace)
    // peels off the surrounding list and leaves the figure standalone.
    await editor.setValue(`<ul><li>${TABLE_HTML}</li></ul>`)
    await editor.select("A")
    await page.keyboard.press("Escape")
    // Table key may resolve to the figure element; toggle once to ensure
    // block-select focus is on the wrapping list item.
    await page.keyboard.press("Shift+Tab")

    await expect.poll(async () => {
      await editor.flush()
      const html = stripDynamicAttrs(normalizeHtml(await editor.value()))
      return html
    }, { timeout: 5_000 }).toMatch(/^<figure[^]*<table>[^]*<\/table>[^]*<\/figure>$/)

    // Cells still present after unwrap.
    const finalHtml = await editor.value()
    expect(finalHtml).toMatch(/<td>[^<]*<p>A<\/p>[^<]*<\/td>/)
    expect(finalHtml).toMatch(/<td>[^<]*<p>B<\/p>[^<]*<\/td>/)
  })

  test("Cmd+Shift+Down moves a wrapped table past a sibling and keeps cells intact", async ({ editor, page }) => {
    await editor.setValue(`<ul><li>${TABLE_HTML}</li></ul><p>Below</p>`)
    await editor.select("A")
    await page.keyboard.press("Escape")

    await page.keyboard.press(`${modifier}+Shift+ArrowDown`)
    await editor.flush()

    const html = stripDynamicAttrs(normalizeHtml(await editor.value()))

    // "Below" should now precede the wrapped table.
    const belowIdx = html.indexOf("Below")
    const tableIdx = html.indexOf("<table>")
    expect(belowIdx).toBeLessThan(tableIdx)

    // Wrapped shape preserved: table still inside <li>.
    expect(html).toMatch(/<li>[^]*<figure[^]*<table>/)
    // Cells preserved.
    expect(html).toMatch(/<td>[^<]*<p>A<\/p>[^<]*<\/td>/)
    expect(html).toMatch(/<td>[^<]*<p>B<\/p>[^<]*<\/td>/)
  })
})
