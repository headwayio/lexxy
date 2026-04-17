import Lexxy from "../config/lexxy.js"

export default class Extensions {

  constructor(lexxyElement) {
    this.lexxyElement = lexxyElement

    this.enabledExtensions = this.#initializeExtensions()
  }

  get lexicalExtensions() {
    return this.enabledExtensions.map(ext => ext.lexicalExtension).filter(Boolean)
  }

  // Look up an enabled extension instance by its class. Returns null if not
  // enabled. Lets elements dispatch to an extension without re-running an
  // instanceof filter at every call site.
  get(klass) {
    return this.enabledExtensions.find(ext => ext instanceof klass) ?? null
  }

  initializeEditors() {
    this.enabledExtensions.forEach(ext => ext.initializeEditor?.())
  }

  initializeToolbars() {
    const toolbar = this.#lexxyToolbar
    if (!toolbar) return

    this.#clearPreviousExtensionToolbarButtons(toolbar)
    this.#addExtensionToolbarButtons(toolbar)
  }

  #clearPreviousExtensionToolbarButtons(toolbar) {
    toolbar.querySelectorAll("[data-lexxy-extension]").forEach(el => el.remove())
  }

  #addExtensionToolbarButtons(toolbar) {
    this.enabledExtensions.forEach(ext => {
      const childrenBefore = new Set(toolbar.children)
      ext.initializeToolbar(toolbar)
      for (const child of toolbar.children) {
        if (!childrenBefore.has(child)) {
          child.setAttribute("data-lexxy-extension", "")
        }
      }
    })
  }

  get allowedElements() {
    return this.enabledExtensions.flatMap(ext => ext.allowedElements)
  }

  get #lexxyToolbar() {
    return this.lexxyElement.toolbar
  }

  get #baseExtensions() {
    return this.lexxyElement.baseExtensions
  }

  get #configuredExtensions() {
    return Lexxy.global.get("extensions")
  }

  #initializeExtensions() {
    const extensionDefinitions = this.#baseExtensions.concat(this.#configuredExtensions)

    return extensionDefinitions.map(
      extension => new extension(this.lexxyElement)
    ).filter(extension => extension.enabled)
  }
}
