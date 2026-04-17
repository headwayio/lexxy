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

test.describe("Block actions menu (Cmd+/)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("Cmd+/ opens block actions menu in block-select mode", async ({ editor, page }) => {
    await editor.setValue("<p>Hello world</p>")
    await editor.select("Hello")
    await page.keyboard.press("Escape")

    await expect(editor.content.locator(".lexxy-editor__block--focused")).toHaveCount(1)

    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
  })

  test("block actions menu shows delete and duplicate options", async ({ editor, page }) => {
    await editor.setValue("<p>First</p><p>Second</p>")
    await editor.select("First")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await expect(menu.locator("[data-action='delete']")).toBeAttached()
    await expect(menu.locator("[data-action='duplicate']")).toBeAttached()
  })

  test("delete action removes the focused block", async ({ editor, page }) => {
    await editor.setValue("<p>Keep</p><p>Remove me</p><p>Also keep</p>")
    await editor.select("Remove me")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Navigate to Delete (4th item: Turn into, Color, Duplicate, Delete)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    await assertBlockHtml(editor, "<p>Keep</p><p>Also keep</p>")
  })

  test("duplicate action copies the focused block", async ({ editor, page }) => {
    await editor.setValue("<p>Original</p><p>Other</p>")
    await editor.select("Original")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Navigate to Duplicate (3rd item: Turn into, Color, Duplicate)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    const count = (html.match(/Original/g) || []).length
    expect(count).toBe(2)
  })

  test("turn-into submenu converts paragraph to heading", async ({ editor, page }) => {
    await editor.setValue("<p>Make me a heading</p>")
    await editor.select("Make me")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // First item is "Turn into" — press ArrowRight to enter submenu
    await page.keyboard.press("ArrowRight")
    // First submenu item is "Text", second is "Heading 2"
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    await assertBlockHtml(editor, "<h2>Make me a heading</h2>")
  })

  test("turn-into Bullet list wraps non-paragraph blocks (heading, blockquote) preserving their type", async ({ editor, page }) => {
    await editor.setValue("<h2>Charlie</h2><blockquote><p>Delta</p></blockquote><p>After</p>")
    await editor.select("Charlie")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Open Turn into submenu, navigate: Text, H2, H3, H4, Bullet list
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    // Non-paragraph blocks are wrapped (not converted) so they keep their
    // type and can host nested children later. Adjacent same-type lists
    // merge during reconciliation.
    await assertBlockHtml(
      editor,
      "<ul><li><h2>Charlie</h2></li><li><blockquote><p>Delta</p></blockquote></li></ul><p>After</p>"
    )
  })

  test("turn-into Bullet list converts paragraphs into plain bullets (not wrapped)", async ({ editor, page }) => {
    await editor.setValue("<p>Para one</p><p>Para two</p><p>After</p>")
    await editor.select("Para one")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    // Paragraph text moves directly into the list item — <li><p>…</p></li>
    // would collapse visually and provides no real wrapper benefit.
    await assertBlockHtml(editor, "<ul><li>Para one</li><li>Para two</li></ul><p>After</p>")
  })

  // Helper: open block-actions menu on the focused block, then return
  // [{cmd, disabled}] for each Turn-into submenu item plus Color's disabled state.
  async function menuState(editor, page, modifier) {
    await page.keyboard.press(`${modifier}+/`)
    await expect(page.locator("lexxy-block-actions")).toBeVisible({ timeout: 2000 })
    return await page.evaluate(() => {
      const menu = document.querySelector("lexxy-block-actions")
      const items = [ ...menu.querySelectorAll("[data-action='turn-into']") ].map(b => ({
        cmd: b.dataset.command,
        disabled: b.hasAttribute("disabled"),
      }))
      const color = menu.querySelector("[data-submenu='color']")
      return { items, colorDisabled: color?.hasAttribute("disabled") }
    })
  }

  test("menu restrictions: HR at root allows only lists + quote", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><hr><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus HR
    const { items, colorDisabled } = await menuState(editor, page, modifier)
    const byCmd = Object.fromEntries(items.map(i => [ i.cmd, i.disabled ]))
    expect(byCmd["setFormatParagraph"]).toBe(true)
    expect(byCmd["setFormatHeadingLarge"]).toBe(true)
    expect(byCmd["setFormatHeadingMedium"]).toBe(true)
    expect(byCmd["setFormatHeadingSmall"]).toBe(true)
    expect(byCmd["insertUnorderedList"]).toBe(false)
    expect(byCmd["insertOrderedList"]).toBe(false)
    expect(byCmd["insertQuoteBlock"]).toBe(false)
    expect(byCmd["insertCodeBlock"]).toBe(true)
    expect(colorDisabled).toBe(true)
  })

  test("menu restrictions: wrapped HR gets the same rule as HR at root (lists + quote)", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><ul><li><hr></li></ul><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus wrapped HR
    const { items, colorDisabled } = await menuState(editor, page, modifier)
    const byCmd = Object.fromEntries(items.map(i => [ i.cmd, i.disabled ]))
    expect(byCmd["setFormatParagraph"]).toBe(true)
    expect(byCmd["setFormatHeadingLarge"]).toBe(true)
    expect(byCmd["insertUnorderedList"]).toBe(false)
    expect(byCmd["insertOrderedList"]).toBe(false)
    expect(byCmd["insertQuoteBlock"]).toBe(false)
    expect(byCmd["insertCodeBlock"]).toBe(true)
    expect(colorDisabled).toBe(true)
  })

  test("menu restrictions: HR wrapped in a blockquote gets the decorator rule", async ({ editor, page }) => {
    // Container-drill: the HR is inside a blockquote (not a list item), but
    // the restriction should still follow the HR's content type.
    await editor.setValue("<p>Before</p><blockquote><hr></blockquote><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus blockquote
    const { items, colorDisabled } = await menuState(editor, page, modifier)
    const byCmd = Object.fromEntries(items.map(i => [ i.cmd, i.disabled ]))
    expect(byCmd["setFormatParagraph"]).toBe(true)
    expect(byCmd["setFormatHeadingLarge"]).toBe(true)
    expect(byCmd["insertUnorderedList"]).toBe(false)
    expect(byCmd["insertOrderedList"]).toBe(false)
    expect(byCmd["insertQuoteBlock"]).toBe(false)
    expect(byCmd["insertCodeBlock"]).toBe(true)
    expect(colorDisabled).toBe(true)
  })

  test("menu restrictions: wrapped code gets the same rule as code at root (text + headings)", async ({ editor, page }) => {
    await editor.setValue("<ul><li><pre data-language=\"plain\">code</pre></li></ul>")
    await editor.select("code")
    await page.keyboard.press("Escape")
    const { items, colorDisabled } = await menuState(editor, page, modifier)
    const byCmd = Object.fromEntries(items.map(i => [ i.cmd, i.disabled ]))
    expect(byCmd["setFormatParagraph"]).toBe(false)
    expect(byCmd["setFormatHeadingLarge"]).toBe(false)
    expect(byCmd["insertUnorderedList"]).toBe(true)
    expect(byCmd["insertOrderedList"]).toBe(true)
    expect(byCmd["insertQuoteBlock"]).toBe(true)
    expect(byCmd["insertCodeBlock"]).toBe(true)
    expect(colorDisabled).toBe(true)
  })

  test("menu restrictions: standalone code at root keeps Text + Headings only", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><pre data-language=\"plain\">code here</pre><p>After</p>")
    await editor.select("code here")
    await page.keyboard.press("Escape")
    const { items, colorDisabled } = await menuState(editor, page, modifier)
    const byCmd = Object.fromEntries(items.map(i => [ i.cmd, i.disabled ]))
    expect(byCmd["setFormatParagraph"]).toBe(false)
    expect(byCmd["setFormatHeadingLarge"]).toBe(false)
    expect(byCmd["setFormatHeadingMedium"]).toBe(false)
    expect(byCmd["setFormatHeadingSmall"]).toBe(false)
    expect(byCmd["insertUnorderedList"]).toBe(true)
    expect(byCmd["insertOrderedList"]).toBe(true)
    expect(byCmd["insertQuoteBlock"]).toBe(true)
    expect(byCmd["insertCodeBlock"]).toBe(true)
    expect(colorDisabled).toBe(true)
  })

  test("menu restrictions: wrapped heading allows all turn-into options", async ({ editor, page }) => {
    await editor.setValue("<ul><li><h2>Wrapped</h2></li></ul>")
    await editor.select("Wrapped")
    await page.keyboard.press("Escape")
    const { items, colorDisabled } = await menuState(editor, page, modifier)
    for (const { disabled } of items) expect(disabled).toBe(false)
    expect(colorDisabled).toBe(false)
  })

  test("block actions menu disables all turn-into options when focused on a table", async ({ editor, page }) => {
    await editor.setValue(
      "<figure class=\"lexxy-content__table-wrapper\"><table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table></figure><p>After</p>"
    )
    await editor.select("A")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Every turn-into option is disabled so the user can't pick a no-op.
    const turnIntoItems = menu.locator("[data-action='turn-into']")
    const count = await turnIntoItems.count()
    for (let i = 0; i < count; i++) {
      await expect(turnIntoItems.nth(i)).toHaveAttribute("disabled", /.*/)
    }
  })

  test("turn-into Bullet list on a mixed selection wraps the heading and table while the paragraph converts — all cells preserved", async ({ editor, page }) => {
    // Mixed selection (heading + table + paragraph). Non-paragraph blocks
    // get wrapped (type preserved). Paragraphs are converted to plain
    // bullets. The critical contract: the table's cells must survive.
    await editor.setValue(
      "<h2>Heading</h2><figure class=\"lexxy-content__table-wrapper\"><table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table></figure><p>After</p>"
    )
    await editor.select("Heading")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    // Table cells preserved.
    expect(html).toContain("<table>")
    expect(html).toMatch(/<td>[^<]*<p>A<\/p>[^<]*<\/td>/)
    expect(html).toMatch(/<td>[^<]*<p>B<\/p>[^<]*<\/td>/)
    // Heading wrapped as wrapped list item (type preserved).
    expect(html).toContain("<li><h2>Heading</h2></li>")
    // Paragraph converted to plain bullet.
    expect(html).toContain("<li>After</li>")
  })

  test("turn-into Bullet list unwraps multiple wrapped blocks into plain bullets", async ({ editor, page }) => {
    await editor.setValue(
      "<ul><li><h2>Wrapped heading</h2></li><li><blockquote>Wrapped quote</blockquote></li></ul><p>After</p>"
    )
    await editor.select("Wrapped heading")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Open Turn into submenu, then navigate: Text, H2, H3, H4, Bullet list
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    await assertBlockHtml(
      editor,
      "<ul><li>Wrapped heading</li><li>Wrapped quote</li></ul><p>After</p>"
    )
  })

  test("Remove Quote menu item appears on a blockquote wrapping non-text and unwraps when clicked", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><blockquote><hr></blockquote><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus blockquote
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    const removeQuote = menu.locator("[data-action='remove-quote']")
    await expect(removeQuote).toBeVisible()
    await expect(removeQuote).toContainText("Remove Quote")

    // Navigate to the Remove Quote item (Turn into, Color, Remove Quote).
    await page.keyboard.press("ArrowDown") // Color
    await page.keyboard.press("ArrowDown") // Remove Quote
    await page.keyboard.press("Enter")

    const html = await editor.value()
    expect(html).toContain("<hr>")
    expect(html).not.toContain("<blockquote>")
  })

  test("Remove Bullet menu item appears on a wrapped block in a bullet list and unwraps to root", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><ul><li><hr></li></ul><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus the wrapped HR (li)
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    const removeList = menu.locator("[data-action='remove-list']")
    await expect(removeList).toBeVisible()
    await expect(removeList).toContainText("Remove Bullet")

    // Main panel: Turn into, Color, Remove List, Duplicate, Delete.
    // Focus starts on Turn into; ArrowDown×2 reaches Remove List.
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    expect(html).toContain("<hr>")
    expect(html).not.toContain("<ul>")
  })

  test("Remove Numbered label appears for wrapped block in an ordered list", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><ol><li><hr></li></ol><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await expect(menu.locator("[data-action='remove-list']")).toContainText("Remove Numbered")
  })

  test("Remove Bullet on a nested wrapped block extracts it all the way to root", async ({ editor, page }) => {
    await editor.setValue(
      "<p>Before</p><ul><li>Alpha</li><li class=\"lexxy-nested-listitem\"><ul><li><hr></li></ul></li></ul><p>After</p>"
    )
    await editor.select("Before")
    await page.keyboard.press("Escape")
    // Navigate to the nested HR: Before → Alpha → HR
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await expect(menu.locator("[data-action='remove-list']")).toBeVisible()

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    // The HR ends up at root level, after the Alpha list segment.
    expect(html).toMatch(/<ul><li>Alpha<\/li><\/ul>\s*<hr>/)
  })

  test("Remove Bullet on a wrapped HR inside a blockquote inside a list extracts all the way to root", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><ul><li><blockquote><hr></blockquote></li></ul><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus the <li>
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Remove Bullet: Turn into, Color, Remove Quote, Remove Bullet (positions 0..3)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    expect(html).toContain("<hr>")
    expect(html).not.toContain("<ul>")
    expect(html).not.toContain("<blockquote>")
  })

  test("Remove Quote on a wrapped HR inside a blockquote inside a list extracts all the way to root", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><ul><li><blockquote><hr></blockquote></li></ul><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Remove Quote: Turn into, Color, Remove Quote (position 2)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    expect(html).toContain("<hr>")
    expect(html).not.toContain("<ul>")
    expect(html).not.toContain("<blockquote>")
  })

  test("Remove Quote menu item is hidden when not inside a blockquote wrapping non-text", async ({ editor, page }) => {
    await editor.setValue("<p>Plain paragraph</p>")
    await editor.select("Plain paragraph")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })
    await expect(menu.locator("[data-action='remove-quote']")).toHaveAttribute("hidden", /.*/)
  })

  test("Turn into Quote on a blockquote wrapping non-text toggles the quote off", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><blockquote><hr></blockquote><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus the blockquote
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    // Open Turn into submenu, navigate to Quote (position 7: Text, H2, H3, H4, Bullet, Number, Quote)
    await page.keyboard.press("ArrowRight")
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    const html = await editor.value()
    expect(html).toContain("<hr>")
    expect(html).not.toContain("<blockquote>")
  })

  test("Escape closes the block actions menu", async ({ editor, page }) => {
    await editor.setValue("<p>Test</p>")
    await editor.select("Test")
    await page.keyboard.press("Escape")
    await page.keyboard.press(`${modifier}+/`)

    const menu = page.locator("lexxy-block-actions")
    await expect(menu).toBeVisible({ timeout: 2000 })

    await page.keyboard.press("Escape")
    await expect(menu).not.toBeVisible({ timeout: 2000 })
  })
})
