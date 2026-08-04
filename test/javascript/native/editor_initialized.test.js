import { afterEach, describe, expect, test } from "vitest"
import { createTestEditorWithNativeAdapter, destroyTestEditor, captureEvent } from "../unit/helpers/editor_helper"

let editorElement

afterEach(async () => {
  await destroyTestEditor(editorElement)
})

describe("editor initialized event", () => {
  test("dispatches event with highlight colors", async () => {
    editorElement = await createTestEditorWithNativeAdapter()

    const event = await captureEvent(editorElement, "lexxy:editor-initialized", () => {
      editorElement.dispatchEditorInitialized()
    })

    expect(event.detail.highlightColors.colors).toBeInstanceOf(Array)
    expect(event.detail.highlightColors.backgroundColors).toBeInstanceOf(Array)
    expect(event.detail.headingFormats).toBeInstanceOf(Array)
  })

  test("each color entry has name and value properties", async () => {
    editorElement = await createTestEditorWithNativeAdapter()

    const event = await captureEvent(editorElement, "lexxy:editor-initialized", () => {
      editorElement.dispatchEditorInitialized()
    })

    for (const color of event.detail.highlightColors.colors) {
      expect(color).toHaveProperty("name")
      expect(color).toHaveProperty("value")
    }

    for (const color of event.detail.highlightColors.backgroundColors) {
      expect(color).toHaveProperty("name")
      expect(color).toHaveProperty("value")
    }
  })

  test("color names correspond to CSS custom properties", async () => {
    editorElement = await createTestEditorWithNativeAdapter()

    const event = await captureEvent(editorElement, "lexxy:editor-initialized", () => {
      editorElement.dispatchEditorInitialized()
    })

    // Default config uses var(--highlight-N) for colors
    for (const color of event.detail.highlightColors.colors) {
      expect(color.name).toMatch(/^var\(--highlight-\d+\)$/)
    }

    // Default config uses var(--highlight-bg-N) for background colors
    for (const color of event.detail.highlightColors.backgroundColors) {
      expect(color.name).toMatch(/^var\(--highlight-bg-\d+\)$/)
    }
  })

  test("dispatches heading formats with a unique command and tag", async () => {
    editorElement = await createTestEditorWithNativeAdapter()

    const event = await captureEvent(editorElement, "lexxy:editor-initialized", () => {
      editorElement.dispatchEditorInitialized()
    })

    expect(event.detail.headingFormats).toEqual([
      { label: "Normal", command: "setFormatParagraph", tag: null },
      { label: "Heading 1", command: "setFormatHeadingXLarge", tag: "h1" },
      { label: "Heading 2", command: "setFormatHeadingLarge", tag: "h2" },
      { label: "Heading 3", command: "setFormatHeadingMedium", tag: "h3" },
      { label: "Heading 4", command: "setFormatHeadingSmall", tag: "h4" },
    ])
  })

  test("maps configured headings by tag, with a generic fallback", async () => {
    editorElement = await createTestEditorWithNativeAdapter({ attributes: { headings: '["h2", "h5"]' } })

    const event = await captureEvent(editorElement, "lexxy:editor-initialized", () => {
      editorElement.dispatchEditorInitialized()
    })

    expect(event.detail.headingFormats).toEqual([
      { label: "Normal", command: "setFormatParagraph", tag: null },
      { label: "Heading 2", command: "setFormatHeadingLarge", tag: "h2" },
      { label: "Heading 5", command: "applyHeadingFormat", tag: "h5" },
    ])
  })
})
