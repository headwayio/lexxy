import ToolbarIcons from "./toolbar_icons"

const TURN_INTO_OPTIONS = [
  { command: "setFormatParagraph", label: "Text", icon: ToolbarIcons.paragraph },
  { command: "setFormatHeadingLarge", label: "Heading 1", icon: ToolbarIcons.h2 },
  { command: "setFormatHeadingMedium", label: "Heading 2", icon: ToolbarIcons.h3 },
  { command: "setFormatHeadingSmall", label: "Heading 3", icon: ToolbarIcons.h4 },
  { command: "insertUnorderedList", label: "Bullet list", icon: ToolbarIcons.ul },
  { command: "insertOrderedList", label: "Numbered list", icon: ToolbarIcons.ol },
  { command: "insertQuoteBlock", label: "Quote", icon: ToolbarIcons.quote },
  { command: "insertCodeBlock", label: "Code block", icon: ToolbarIcons.code },
]

export class BlockActionsMenu extends HTMLElement {
  #onClose = null
  #onAction = null
  #focusedIndex = -1
  #openSubmenuName = null

  connectedCallback() {
    this.#render()
    this.addEventListener("click", this.#handleClick)
    this.addEventListener("keydown", this.#handleKeydown)
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.#handleClick)
    this.removeEventListener("keydown", this.#handleKeydown)
  }

  show({ anchorRect, editorElement, onAction, onClose }) {
    this.#onAction = onAction
    this.#onClose = onClose
    this.#closeAllSubmenus()

    // Build color options from editor config
    const colorConfig = editorElement.config.get("highlight.buttons")
    if (colorConfig) {
      this.#buildColorSubmenu(colorConfig)
    }

    this.#position(anchorRect)
    this.hidden = false
    this.#focusItem(0)
  }

  close() {
    this.hidden = true
    this.#closeAllSubmenus()
    this.#onClose?.()
  }

  #render() {
    this.setAttribute("role", "menu")
    this.setAttribute("tabindex", "-1")
    this.innerHTML = `
      <div class="lexxy-block-actions__panel" data-panel="main">
        <div class="lexxy-block-actions__section">
          <button type="button" role="menuitem" data-submenu="turn-into" class="lexxy-block-actions__item">
            <span class="lexxy-block-actions__label">Turn into</span>
            <span class="lexxy-block-actions__chevron">›</span>
          </button>
          <button type="button" role="menuitem" data-submenu="color" class="lexxy-block-actions__item">
            <span class="lexxy-block-actions__icon">${PALETTE_ICON}</span>
            <span class="lexxy-block-actions__label">Color</span>
            <span class="lexxy-block-actions__chevron">›</span>
          </button>
        </div>
        <div class="lexxy-block-actions__divider"></div>
        <div class="lexxy-block-actions__section">
          <button type="button" role="menuitem" data-action="duplicate" class="lexxy-block-actions__item">
            <span class="lexxy-block-actions__label">Duplicate</span>
            <span class="lexxy-block-actions__shortcut">⌘D</span>
          </button>
          <button type="button" role="menuitem" data-action="delete" class="lexxy-block-actions__item">
            <span class="lexxy-block-actions__label">Delete</span>
            <span class="lexxy-block-actions__shortcut">⌫</span>
          </button>
        </div>
      </div>
      <div class="lexxy-block-actions__panel lexxy-block-actions__flyout" data-panel="turn-into" hidden>
        ${TURN_INTO_OPTIONS.map(opt => `
          <button type="button" role="menuitem" data-action="turn-into" data-command="${opt.command}" class="lexxy-block-actions__item">
            <span class="lexxy-block-actions__icon">${opt.icon}</span>
            <span class="lexxy-block-actions__label">${opt.label}</span>
          </button>
        `).join("")}
      </div>
      <div class="lexxy-block-actions__panel lexxy-block-actions__flyout" data-panel="color" hidden></div>
    `
  }

  #buildColorSubmenu(colorConfig) {
    const panel = this.querySelector('[data-panel="color"]')
    if (!panel) return

    let html = ""

    if (colorConfig.color?.length) {
      html += `<div class="lexxy-block-actions__color-label">Text</div>
        <div class="lexxy-block-actions__color-row">
          ${colorConfig.color.map(c => `<button type="button" class="lexxy-block-actions__color-swatch" data-action="color" data-style="color" data-value="${c}" style="color:${c}" title="${c}"><span>A</span></button>`).join("")}
        </div>`
    }

    if (colorConfig["background-color"]?.length) {
      html += `<div class="lexxy-block-actions__color-label">Background</div>
        <div class="lexxy-block-actions__color-row">
          ${colorConfig["background-color"].map(c => `<button type="button" class="lexxy-block-actions__color-swatch" data-action="color" data-style="background-color" data-value="${c}" style="background-color:${c}" title="${c}"></button>`).join("")}
        </div>`
    }

    html += `<button type="button" role="menuitem" data-action="remove-color" class="lexxy-block-actions__item">
      <span class="lexxy-block-actions__label">Remove color</span>
    </button>`

    panel.innerHTML = html
  }

  #position(anchorRect) {
    const menuWidth = 200
    const menuHeight = 180

    let left = anchorRect.left
    let top = anchorRect.bottom + 4

    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = anchorRect.top - menuHeight - 4
    }
    if (left < 8) left = 8
    if (top < 8) top = 8

    this.style.left = `${left}px`
    this.style.top = `${top}px`
  }

  // -- Focus management -------------------------------------------------------

  get #activePanel() {
    if (this.#openSubmenuName) {
      return this.querySelector(`[data-panel="${this.#openSubmenuName}"]`)
    }
    return this.querySelector('[data-panel="main"]')
  }

  get #menuItems() {
    const panel = this.#activePanel
    return panel ? [...panel.querySelectorAll("button[role='menuitem']")] : []
  }

  #focusItem(index) {
    // Clear all focused states across all panels
    for (const item of this.querySelectorAll(".lexxy-block-actions__item--focused")) {
      item.classList.remove("lexxy-block-actions__item--focused")
    }

    const items = this.#menuItems
    if (items.length === 0) return

    this.#focusedIndex = Math.max(0, Math.min(index, items.length - 1))
    items[this.#focusedIndex]?.classList.add("lexxy-block-actions__item--focused")
    items[this.#focusedIndex]?.scrollIntoView({ block: "nearest" })
  }

  // -- Submenu management -----------------------------------------------------

  #openSubmenu(name) {
    this.#closeAllSubmenus()

    const panel = this.querySelector(`[data-panel="${name}"]`)
    if (!panel) return

    // Position the flyout aligned with the trigger button
    const trigger = this.querySelector(`[data-submenu="${name}"]`)
    if (trigger) {
      const triggerRect = trigger.getBoundingClientRect()
      const mainPanel = this.querySelector('[data-panel="main"]')
      const mainRect = mainPanel.getBoundingClientRect()

      // Align top of flyout with the trigger row
      panel.style.top = `${triggerRect.top - mainRect.top}px`
    }

    panel.hidden = false
    trigger?.classList.add("lexxy-block-actions__item--active")
    this.#openSubmenuName = name
    this.#focusItem(0)
  }

  #closeAllSubmenus() {
    for (const panel of this.querySelectorAll(".lexxy-block-actions__flyout")) {
      panel.hidden = true
    }
    for (const item of this.querySelectorAll(".lexxy-block-actions__item--active")) {
      item.classList.remove("lexxy-block-actions__item--active")
    }
    this.#openSubmenuName = null
  }

  // -- Event handlers ---------------------------------------------------------

  #handleClick = (event) => {
    const button = event.target.closest("button")
    if (!button) return

    const submenuName = button.dataset.submenu
    if (submenuName) {
      this.#openSubmenu(submenuName)
      return
    }

    if (button.dataset.action === "color") {
      this.#onAction?.({ type: "color", style: button.dataset.style, value: button.dataset.value })
      this.close()
      return
    }

    if (button.dataset.action === "remove-color") {
      this.#onAction?.({ type: "remove-color" })
      this.close()
      return
    }

    if (button.dataset.action === "turn-into") {
      this.#onAction?.({ type: "turn-into", command: button.dataset.command })
      this.close()
      return
    }

    const action = button.dataset.action
    if (action) {
      this.#onAction?.({ type: action })
      this.close()
    }
  }

  #handleKeydown = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        event.stopPropagation()
        this.#focusItem(this.#focusedIndex + 1)
        break
      case "ArrowUp":
        event.preventDefault()
        event.stopPropagation()
        this.#focusItem(this.#focusedIndex - 1)
        break
      case "ArrowRight": {
        event.preventDefault()
        event.stopPropagation()
        const items = this.#menuItems
        const focused = items[this.#focusedIndex]
        if (focused?.dataset.submenu) {
          this.#openSubmenu(focused.dataset.submenu)
        }
        break
      }
      case "ArrowLeft":
        event.preventDefault()
        event.stopPropagation()
        if (this.#openSubmenuName) {
          // Find the trigger index to restore focus
          const submenuName = this.#openSubmenuName
          this.#closeAllSubmenus()
          const mainItems = this.#menuItems
          const triggerIndex = mainItems.findIndex(item => item.dataset.submenu === submenuName)
          this.#focusItem(triggerIndex >= 0 ? triggerIndex : 0)
        }
        break
      case "Enter": {
        event.preventDefault()
        event.stopPropagation()
        const items = this.#menuItems
        items[this.#focusedIndex]?.click()
        break
      }
      case "Escape":
        event.preventDefault()
        event.stopPropagation()
        if (this.#openSubmenuName) {
          const submenuName = this.#openSubmenuName
          this.#closeAllSubmenus()
          const mainItems = this.#menuItems
          const triggerIndex = mainItems.findIndex(item => item.dataset.submenu === submenuName)
          this.#focusItem(triggerIndex >= 0 ? triggerIndex : 0)
        } else {
          this.close()
        }
        break
    }
  }
}

const PALETTE_ICON = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7c.644 0 1.167-.523 1.167-1.167 0-.303-.117-.573-.292-.77a1.15 1.15 0 01-.292-.763c0-.644.523-1.167 1.167-1.167h1.377c2.254 0 4.083-1.829 4.083-4.083C14.21 3.757 11.454 1 8 1zM3.917 8a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333zm2.333-3.5a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333zm3.5 0a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333zm2.333 3.5a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333z" fill="currentColor"/>
</svg>`

export default BlockActionsMenu
