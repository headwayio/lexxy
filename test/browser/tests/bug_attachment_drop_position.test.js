import { test } from "../test_helper.js"
import { expect } from "@playwright/test"
import { mockActiveStorageUploads } from "../helpers/active_storage_mock.js"

test.describe("Bug: Dropped attachments placed at wrong position", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/attachments.html")
    await page.waitForSelector("lexxy-editor[connected]")
    await page.waitForSelector("lexxy-toolbar[connected]")
    await mockActiveStorageUploads(page)
  })

  test("image dropped between paragraphs lands at drop position, not at end", async ({ page, editor }) => {
    await editor.setValue("<p>First paragraph</p><p>Second paragraph</p>")
    await editor.flush()

    // Place the cursor at the end of the second paragraph — simulating where
    // the cursor was before the user started dragging a file from the desktop
    const secondParagraph = editor.content.locator("p").nth(1)
    await secondParagraph.click()
    await editor.send("End")
    await editor.flush()

    // Get coordinates for the first paragraph (the intended drop target)
    const firstParagraph = editor.content.locator("p").first()
    const firstParagraphBox = await firstParagraph.boundingBox()
    const dropX = firstParagraphBox.x + firstParagraphBox.width / 2
    const dropY = firstParagraphBox.y + firstParagraphBox.height / 2

    await simulateExternalFileDrop(page, editor, {
      dropX, dropY,
      fileName: "dropped.png",
      mimeType: "image/png"
    })

    // Wait for the attachment to appear
    const figure = page.locator("figure.attachment")
    await expect(figure).toBeVisible({ timeout: 10_000 })
    await editor.flush()

    // The attachment should appear between the two paragraphs, not after the second
    const childDescriptions = await describeContentChildren(editor)
    const firstParagraphIndex = childDescriptions.findIndex(c => c === "p:First paragraph")
    const secondParagraphIndex = childDescriptions.findIndex(c => c === "p:Second paragraph")
    const figureIndex = childDescriptions.findIndex(c => c === "figure" || c === "figure-wrapper")

    expect(figureIndex).toBeGreaterThan(firstParagraphIndex)
    expect(figureIndex).toBeLessThan(secondParagraphIndex)
  })
})

// Simulates a file drop from an external source (e.g., the OS file manager).
//
// During a real external drag, the browser does NOT update the DOM selection
// to the drop coordinates — the drag caret is purely visual. To reproduce this,
// we intercept the drop event (preventing the browser from moving the caret via
// the synthetic DragEvent), restore the stale DOM selection, and call the
// editor's dropFiles method directly with the drop coordinates. The dropFiles
// method must use caretRangeFromPoint to position the caret at the drop point
// before uploading, or the files will land at the stale cursor position.
async function simulateExternalFileDrop(page, editor, { dropX, dropY, fileName, mimeType }) {
  await page.evaluate(
    ({ dropX, dropY, fileName, mimeType, editorSelector }) => {
      const editorElement = document.querySelector(editorSelector)
      const root = editorElement.editor.getRootElement()

      // Capture the stale DOM selection (cursor at end of second paragraph)
      const sel = window.getSelection()
      const staleAnchorNode = sel.anchorNode
      const staleAnchorOffset = sel.anchorOffset
      const staleFocusNode = sel.focusNode
      const staleFocusOffset = sel.focusOffset

      // Intercept the drop event to prevent Lexical and the browser from
      // reconciling the synthetic caret position, then invoke dropFiles
      // with the stale selection and drop coordinates.
      root.addEventListener("drop", (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()

        // Restore the stale DOM selection (simulating a real external drag)
        const sel = window.getSelection()
        sel.setBaseAndExtent(staleAnchorNode, staleAnchorOffset, staleFocusNode, staleFocusOffset)
        editorElement.editor._pendingEditorState = null

        const files = Array.from(event.dataTransfer.files)
        if (files.length) {
          editorElement.contents.dropFiles(files, {
            clientX: event.clientX,
            clientY: event.clientY
          })
          editorElement.editor.focus()
        }
      }, { capture: true, once: true })

      const file = new File(["fake data"], fileName, { type: mimeType })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)

      root.dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: dropX,
        clientY: dropY,
        dataTransfer
      }))
    },
    { dropX, dropY, fileName, mimeType, editorSelector: editor.selector }
  )
}

async function describeContentChildren(editor) {
  return editor.content.evaluate((el) => {
    return Array.from(el.children).map((child) => {
      if (child.tagName === "P") return `p:${child.textContent}`
      if (child.tagName === "FIGURE") return "figure"
      if (child.querySelector("figure")) return "figure-wrapper"
      return `${child.tagName.toLowerCase()}:${child.className}`
    })
  })
}
