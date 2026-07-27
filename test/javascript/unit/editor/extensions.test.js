import { expect, test } from "vitest"
import Extensions from "src/editor/extensions"

class DestroyableExtension {
  constructor() {
    this.enabled = true
    this.destroyCount = 0
  }

  destroy() {
    this.destroyCount++
  }
}

class PlainExtension {
  constructor() {
    this.enabled = true
  }
}

function buildExtensions() {
  const lexxyElement = { baseExtensions: [ DestroyableExtension, PlainExtension ] }
  return new Extensions(lexxyElement)
}

test("destroy dispatches once to every extension that supports it", () => {
  const extensions = buildExtensions()
  const [ destroyable ] = extensions.enabledExtensions

  extensions.destroy()

  expect(destroyable.destroyCount).toBe(1)
  expect(extensions.enabledExtensions).toEqual([])
})

test("destroy tolerates extensions without a destroy method", () => {
  const extensions = buildExtensions()

  expect(() => extensions.destroy()).not.toThrow()
})

test("destroy is idempotent", () => {
  const extensions = buildExtensions()
  const [ destroyable ] = extensions.enabledExtensions

  extensions.destroy()
  extensions.destroy()

  expect(destroyable.destroyCount).toBe(1)
})
