import Lexxy from "../config/lexxy.js"

export default class Extensions {

  constructor(lexxyElement) {
    this.lexxyElement = lexxyElement

    this.enabledExtensions = this.#initializeExtensions()
  }

  get lexicalExtensions() {
    return this.enabledExtensions.map(ext => ext.lexicalExtension).filter(Boolean)
  }

  initializeEditors() {
    this.enabledExtensions.forEach(ext => ext.initializeEditor?.())
  }

  initializeToolbars() {
    if (this.#lexxyToolbar) {
      this.enabledExtensions.forEach(ext => ext.initializeToolbar(this.#lexxyToolbar))
    }
  }

  // Dispatches destroy to every extension that supports it, exactly once.
  // Extensions own their document-level listeners (e.g. BlockSelection's
  // keydown), so skipping this on editor reset leaks inert handlers and
  // retains the editor graph across open/close cycles.
  destroy() {
    const extensions = this.enabledExtensions
    this.enabledExtensions = []
    extensions.forEach(ext => ext.destroy?.())
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
