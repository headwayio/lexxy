import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { defineElements } from "src/elements"

// jsdom gaps, irrelevant to the lifecycle under test.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof ElementInternals !== "undefined") {
  ElementInternals.prototype.setFormValue ??= () => {}
  ElementInternals.prototype.setValidity ??= () => {}
}

if (!customElements.get("lexxy-editor")) defineElements()

// Removing a <lexxy-editor> (or Turbo caching a page) must dispatch destroy to
// every registered extension: BlockSelectionExtension owns removal of a
// document-level keydown listener, so a reset that skips extension destruction
// retains inert listeners and the editor graph across open/close cycles.

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function mountEditor() {
  const element = document.createElement("lexxy-editor")
  document.body.appendChild(element)
  await nextFrame()
  return element
}

beforeEach(() => {
  document.body.innerHTML = ""
})

afterEach(() => {
  vi.restoreAllMocks()
})

test("disconnect dispatches destroy to every registered extension", async () => {
  const element = await mountEditor()
  const extensions = element.extensions.enabledExtensions
  expect(extensions.length).toBeGreaterThan(0)

  const spies = extensions
    .filter((extension) => typeof extension.destroy === "function")
    .map((extension) => vi.spyOn(extension, "destroy"))
  expect(spies.length).toBeGreaterThan(0)

  element.remove()
  await nextFrame()

  spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
})

test("repeated open/close does not grow document-level listeners", async () => {
  const outstanding = new Map()
  const originalAdd = document.addEventListener.bind(document)
  const originalRemove = document.removeEventListener.bind(document)
  vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
    outstanding.set(listener, type)
    originalAdd(type, listener, options)
  })
  vi.spyOn(document, "removeEventListener").mockImplementation((type, listener, options) => {
    outstanding.delete(listener)
    originalRemove(type, listener, options)
  })

  const counts = []
  for (let cycle = 0; cycle < 3; cycle++) {
    const element = await mountEditor()
    element.remove()
    await nextFrame()
    counts.push(outstanding.size)
  }

  // One-time singletons may register on the first cycle; growth across the
  // later cycles is the leak (inert per-editor handlers piling up).
  expect(counts[2]).toBe(counts[1])
  expect(counts[1]).toBe(counts[0])
})
