import { expect } from "@playwright/test"
import { normalizeHtml } from "./html.js"

// Assert editor HTML value matches expected (with retries + normalization).
export async function assertEditorHtml(editor, expected) {
  await expect
    .poll(
      async () => {
        await editor.flush()
        return normalizeHtml(await editor.value())
      },
      { timeout: 5_000 },
    )
    .toBe(normalizeHtml(expected))
}

// Assert against the editor's content element using a callback with Playwright locator assertions.
// Usage: await assertEditorContent(editor, async (content) => { await expect(content.locator('a')).toHaveText('link') })
export async function assertEditorContent(editor, assertionFn) {
  await editor.flush()
  await assertionFn(editor.content)
}

// Assert editor plain text value.
export async function assertEditorPlainText(editor, expected) {
  await expect
    .poll(
      async () => {
        await editor.flush()
        return await editor.plainTextValue()
      },
      { timeout: 5_000 },
    )
    .toBe(expected)
}

// Assert table structure inside the editor.
export async function assertEditorTableStructure(editor, cols, rows) {
  await editor.flush()
  await expect(editor.content.locator("table tr")).toHaveCount(rows)
  await expect(
    editor.content.locator("table tr").first().locator("td, th"),
  ).toHaveCount(cols)
}

// Strip attributes whose value is derived from transient block-selection state
// (bullet depth, list-item type, wrap origin). Tests assert on structure, not
// on these decorations.
export function stripDynamicAttrs(html) {
  return html
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
    .replace(/\s*data-block-movement-wrapped="[^"]*"/g, "")
}

// Like assertEditorHtml but also strips dynamic block-selection attrs.
export async function assertBlockHtml(editor, expected) {
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
