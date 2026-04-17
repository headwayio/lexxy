import { test } from "../../test_helper.js"
import { assertBlockHtml } from "../../helpers/assertions.js"

test.describe("Wrapped block outdent at root", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForSelector("lexxy-editor[connected]")
  })

  test("Shift+Tab on a single wrapped heading at root unwraps it", async ({ editor, page }) => {
    await editor.setValue("<ul><li><h2>Only heading</h2></li></ul><p>After</p>")
    await editor.select("Only heading")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(editor, "<h2>Only heading</h2><p>After</p>")
  })

  test("Shift+Tab on a single wrapped blockquote at root unwraps it", async ({ editor, page }) => {
    await editor.setValue("<ul><li><blockquote>A quote</blockquote></li></ul><p>After</p>")
    await editor.select("A quote")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(editor, "<blockquote>A quote</blockquote><p>After</p>")
  })

  test("Shift+Tab on two wrapped blocks (heading + blockquote) in their own list unwraps both", async ({ editor, page }) => {
    await editor.setValue(
      "<ul><li><h2>Wrapped heading</h2></li><li><blockquote>Wrapped quote</blockquote></li></ul><p>After</p>"
    )
    await editor.select("Wrapped heading")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(
      editor,
      "<h2>Wrapped heading</h2><blockquote>Wrapped quote</blockquote><p>After</p>"
    )
  })

  test("Shift+Tab on one of two wrapped blocks splits the list", async ({ editor, page }) => {
    await editor.setValue(
      "<ul><li><h2>First heading</h2></li><li><h2>Second heading</h2></li></ul><p>After</p>"
    )
    await editor.select("First heading")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(
      editor,
      "<h2>First heading</h2><ul><li><h2>Second heading</h2></li></ul><p>After</p>"
    )
  })

  test("Shift+Tab on a blockquote wrapping an HR unwraps it to standalone", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><blockquote><hr></blockquote><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown") // focus blockquote
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(editor, "<p>Before</p><hr><p>After</p>")
  })

  test("Shift+Tab on a blockquote wrapping a heading unwraps the heading", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><blockquote><h2>Quoted heading</h2></blockquote><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(editor, "<p>Before</p><h2>Quoted heading</h2><p>After</p>")
  })

  test("Shift+Tab on a text-only blockquote is a no-op (use Turn into Text instead)", async ({ editor, page }) => {
    await editor.setValue("<p>Before</p><blockquote>Plain quote</blockquote><p>After</p>")
    await editor.select("Before")
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(editor, "<p>Before</p><blockquote>Plain quote</blockquote><p>After</p>")
  })

  test("Shift+Tab on wrapped heading between regular bullets keeps bullets in naturally-formed segments", async ({ editor, page }) => {
    await editor.setValue(
      "<ul><li>Before</li><li><h2>Wrapped</h2></li><li>After</li></ul><p>End</p>"
    )
    await editor.select("Wrapped")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+Tab")

    await assertBlockHtml(
      editor,
      "<ul><li>Before</li></ul><h2>Wrapped</h2><ul><li>After</li></ul><p>End</p>"
    )
  })
})
