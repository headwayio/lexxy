import ToolbarIcons from "./toolbar_icons"
import { VIEWPORT_PADDING } from "../editor/block_helpers"
import { getLastUsedColor, saveLastUsedColor } from "../helpers/storage_helper"

const PALETTE_ICON = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7c.644 0 1.167-.523 1.167-1.167 0-.303-.117-.573-.292-.77a1.15 1.15 0 01-.292-.763c0-.644.523-1.167 1.167-1.167h1.377c2.254 0 4.083-1.829 4.083-4.083C14.21 3.757 11.454 1 8 1zM3.917 8a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333zm2.333-3.5a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333zm3.5 0a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333zm2.333 3.5a1.167 1.167 0 110-2.333 1.167 1.167 0 010 2.333z" fill="currentColor"/>
</svg>`

const TURN_INTO_OPTIONS = [
  { command: "setFormatParagraph", label: "Text", icon: ToolbarIcons.paragraph },
  { command: "setFormatHeadingLarge", label: "Heading 2", icon: ToolbarIcons.h2 },
  { command: "setFormatHeadingMedium", label: "Heading 3", icon: ToolbarIcons.h3 },
  { command: "setFormatHeadingSmall", label: "Heading 4", icon: ToolbarIcons.h4 },
  { command: "insertUnorderedList", label: "Bullet list", icon: ToolbarIcons.ul },
  { command: "insertOrderedList", label: "Numbered list", icon: ToolbarIcons.ol },
  { command: "insertQuoteBlock", label: "Quote", icon: ToolbarIcons.quote },
  { command: "insertCodeBlock", label: "Code block", icon: ToolbarIcons.code },
]

const COLOR_NAMES = [ "Yellow", "Orange", "Red", "Pink", "Purple", "Blue", "Green", "Brown", "Gray" ]

// Derives a human-readable label ("Yellow text", "Orange background") from
// a CSS var referencing the default highlight palette. Exported so the
// highlight dropdown can record the same label when saving last-used-color.
export function colorLabel(cssVar, style) {
  const match = cssVar.match(/--highlight-(?:bg-)?(\d+)/)
  const name = match ? COLOR_NAMES[parseInt(match[1]) - 1] || `Color ${match[1]}` : cssVar
  return style === "background-color" ? `${name} background` : `${name} text`
}

export class BlockActionsMenu extends HTMLElement {
  #onClose = null
  #onAction = null
  #focusedIndex = -1
  #openSubmenuName = null
  #clickOutsideHandler = null
  #mouseActivated = false
  #editorElement = null
  #lastMouseX = -1
  #lastMouseY = -1
  #anchorElement = null
  #scrollHandler = null
  #resizeHandler = null

  connectedCallback() {
    this.#render()
    this.addEventListener("click", this.#handleClick)
    this.addEventListener("keydown", this.#handleKeydown)
    this.addEventListener("mouseenter", this.#handleMouseenter, true)
    this.addEventListener("mouseleave", this.#handleMouseleave, true)
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.#handleClick)
    this.removeEventListener("keydown", this.#handleKeydown)
    this.removeEventListener("mouseenter", this.#handleMouseenter, true)
    this.removeEventListener("mouseleave", this.#handleMouseleave, true)
    document.removeEventListener("mousemove", this.#handleMousemove)
    this.#removeClickOutsideListener()
    this.#removeScrollResizeListeners()
  }

  show({ anchorElement, anchorRect, editorElement, onAction, onClose, blockRestriction = null, canUnwrapFromQuote = false, unwrapListType = null }) {
    this.#onAction = onAction
    this.#onClose = onClose
    this.#anchorElement = anchorElement || null
    this.#editorElement = editorElement
    this.#closeAllSubmenus()

    // Build color options from editor config
    const colorConfig = editorElement.config.get("highlight.buttons")
    if (colorConfig) {
      this.#buildColorSubmenu(colorConfig)
    }

    this.#applyBlockRestrictions(blockRestriction)

    // Contextual top-level actions. Only visible when the focused block
    // actually has a wrapper we can remove — a blockquote wrapping non-text
    // content, or a list item wrapping non-text content. For decorators
    // (images, HR, attachments) these are the only discoverable way to get
    // the content out of its wrapper, since Turn into Text isn't available.
    const removeQuoteBtn = this.querySelector("[data-action='remove-quote']")
    if (removeQuoteBtn) removeQuoteBtn.hidden = !canUnwrapFromQuote

    const removeListBtn = this.querySelector("[data-action='remove-list']")
    if (removeListBtn) {
      removeListBtn.hidden = unwrapListType === null
      const label = removeListBtn.querySelector(".lexxy-block-actions__label")
      if (label) label.textContent = unwrapListType === "number" ? "Remove Numbered" : "Remove Bullet"
    }

    const rect = anchorElement ? anchorElement.getBoundingClientRect() : anchorRect
    this.#position(rect)
    this.hidden = false
    this.#deactivateMouse()
    this.#focusFirstEnabledItem()
    this.#addClickOutsideListener()
    document.addEventListener("mousemove", this.#handleMousemove)
    this.#addScrollResizeListeners()
  }

  // Per-content-type turn-into and color restrictions. The wrapped-in-a-list
  // variant of each content type uses the same rule as its standalone
  // counterpart — what's meaningful for the content doesn't change based on
  // whether it currently lives inside a list item.
  //
  //   code:      Text + Headings only, no color
  //              (lists/quote would drop code formatting; color conflicts
  //              with syntax highlighting)
  //   table:     No turn-into (every conversion wipes cell data), color allowed
  //   decorator: Bullet/Number/Quote only, no color
  //              (HR or attachment — no text to convert to Text/Headings/Code;
  //              color has nothing to apply to)
  //   null:      everything enabled (paragraph, heading, quote, and their
  //              wrapped-in-li counterparts)
  #applyBlockRestrictions(restriction) {
    const HEADINGS = [ "setFormatHeadingLarge", "setFormatHeadingMedium", "setFormatHeadingSmall" ]
    const LISTS = [ "insertUnorderedList", "insertOrderedList" ]

    const rules = {
      code:      { commands: new Set([ "setFormatParagraph", ...HEADINGS ]), color: false },
      table:     { commands: new Set(), color: true },
      decorator: { commands: new Set([ ...LISTS, "insertQuoteBlock" ]), color: false },
    }

    const rule = restriction ? rules[restriction] : null

    for (const button of this.querySelectorAll("[data-action=\"turn-into\"]")) {
      const disable = rule ? !rule.commands.has(button.dataset.command) : false
      button.toggleAttribute("disabled", disable)
      button.setAttribute("aria-disabled", String(disable))
    }

    for (const button of this.querySelectorAll("[data-submenu=\"color\"]")) {
      const disable = rule ? !rule.color : false
      button.toggleAttribute("disabled", disable)
      button.setAttribute("aria-disabled", String(disable))
    }
  }

  #focusFirstEnabledItem() {
    const items = [ ...this.querySelectorAll("[role=\"menuitem\"]") ]
    const idx = items.findIndex(b => !b.hasAttribute("disabled"))
    this.#focusItem(idx >= 0 ? idx : 0)
  }

  close() {
    this.hidden = true
    this.#anchorElement = null
    this.#closeAllSubmenus()
    this.#removeClickOutsideListener()
    this.#removeScrollResizeListeners()
    document.removeEventListener("mousemove", this.#handleMousemove)
    this.#editorElement?.classList.remove("lexxy-editor--keyboard-menu")
    this.#editorElement = null
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
          <button type="button" role="menuitem" data-action="remove-quote" class="lexxy-block-actions__item" hidden>
            <span class="lexxy-block-actions__label">Remove Quote</span>
          </button>
          <button type="button" role="menuitem" data-action="remove-list" class="lexxy-block-actions__item" hidden>
            <span class="lexxy-block-actions__label">Remove Bullet</span>
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
    const panel = this.querySelector("[data-panel=\"color\"]")
    if (!panel) return

    let html = ""

    const last = getLastUsedColor()
    if (last) {
      const swatchStyle = last.style === "background-color"
        ? `background-color:${last.value}`
        : `color:${last.value}`
      const swatchContent = last.style === "color" ? "A" : ""
      html += `<div class="lexxy-block-actions__color-label">Last used</div>
        <button type="button" role="menuitem" class="lexxy-block-actions__item" data-action="color" data-style="${last.style}" data-value="${last.value}">
          <span class="lexxy-block-actions__color-swatch" style="${swatchStyle}">${swatchContent}</span>
          <span class="lexxy-block-actions__label">${last.label}</span>
          <span class="lexxy-block-actions__shortcut">⌘⇧H</span>
        </button>
        <div class="lexxy-block-actions__divider"></div>`
    }

    if (colorConfig.color?.length) {
      html += "<div class=\"lexxy-block-actions__color-label\">Text color</div>"
      html += colorConfig.color.map(c => `
        <button type="button" role="menuitem" class="lexxy-block-actions__item" data-action="color" data-style="color" data-value="${c}">
          <span class="lexxy-block-actions__color-swatch" style="color:${c}">A</span>
          <span class="lexxy-block-actions__label">${colorLabel(c, "color")}</span>
        </button>
      `).join("")
    }

    if (colorConfig["background-color"]?.length) {
      html += "<div class=\"lexxy-block-actions__color-label\">Background color</div>"
      html += colorConfig["background-color"].map(c => `
        <button type="button" role="menuitem" class="lexxy-block-actions__item" data-action="color" data-style="background-color" data-value="${c}">
          <span class="lexxy-block-actions__color-swatch" style="background-color:${c}"></span>
          <span class="lexxy-block-actions__label">${colorLabel(c, "background-color")}</span>
        </button>
      `).join("")
    }

    html += `<div class="lexxy-block-actions__divider"></div>
      <button type="button" role="menuitem" data-action="remove-color" class="lexxy-block-actions__item">
        <span class="lexxy-block-actions__label">Remove color</span>
      </button>`

    panel.innerHTML = html
  }

  #position(anchorRect) {
    const mainPanel = this.querySelector("[data-panel=\"main\"]")

    // Measure dimensions — if menu is already visible we can read directly,
    // otherwise show off-screen momentarily to measure.
    let menuWidth, menuHeight
    if (!this.hidden && mainPanel) {
      menuWidth = mainPanel.offsetWidth
      menuHeight = mainPanel.offsetHeight
    } else if (mainPanel) {
      const prevLeft = this.style.left
      const prevTop = this.style.top
      this.style.left = "-9999px"
      this.style.top = "-9999px"
      this.hidden = false
      menuWidth = mainPanel.offsetWidth
      menuHeight = mainPanel.offsetHeight
      this.hidden = true
      this.style.left = prevLeft
      this.style.top = prevTop
    } else {
      menuWidth = 200
      menuHeight = 180
    }

    let left = anchorRect.left
    let top = anchorRect.bottom + 4

    // Clamp right edge
    if (left + menuWidth > window.innerWidth - VIEWPORT_PADDING) {
      left = window.innerWidth - menuWidth - VIEWPORT_PADDING
    }
    // Flip above anchor if not enough room below
    if (top + menuHeight > window.innerHeight - VIEWPORT_PADDING) {
      top = anchorRect.top - menuHeight - 4
    }
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING
    if (top < VIEWPORT_PADDING) top = VIEWPORT_PADDING

    this.style.left = `${left}px`
    this.style.top = `${top}px`
  }

  // -- Scroll & resize tracking -----------------------------------------------

  #addScrollResizeListeners() {
    this.#scrollHandler = () => this.#repositionFromAnchor()
    this.#resizeHandler = () => this.#repositionFromAnchor()

    // Listen on the capture phase so we catch scrolls on any ancestor
    window.addEventListener("scroll", this.#scrollHandler, true)
    window.addEventListener("resize", this.#resizeHandler)
  }

  #removeScrollResizeListeners() {
    if (this.#scrollHandler) {
      window.removeEventListener("scroll", this.#scrollHandler, true)
      this.#scrollHandler = null
    }
    if (this.#resizeHandler) {
      window.removeEventListener("resize", this.#resizeHandler)
      this.#resizeHandler = null
    }
  }

  #repositionFromAnchor() {
    if (!this.#anchorElement || this.hidden) return

    const rect = this.#anchorElement.getBoundingClientRect()

    // If the anchor has scrolled entirely out of view, close the menu
    if (rect.bottom < 0 || rect.top > window.innerHeight ||
        rect.right < 0 || rect.left > window.innerWidth) {
      this.close()
      return
    }

    this.#position(rect)
    // Reposition any open submenu too
    if (this.#openSubmenuName) {
      this.#positionSubmenu(this.#openSubmenuName)
    }
  }

  // -- Focus management -------------------------------------------------------

  get #activePanel() {
    if (this.#openSubmenuName) {
      return this.querySelector(`[data-panel="${this.#openSubmenuName}"]`)
    }
    return this.querySelector("[data-panel=\"main\"]")
  }

  get #menuItems() {
    const panel = this.#activePanel
    // Exclude hidden items (e.g. contextual "Remove Quote") from keyboard
    // navigation so ArrowDown lands on a visible item.
    return panel ? [ ...panel.querySelectorAll("button[role='menuitem']") ].filter(b => !b.hidden) : []
  }

  #focusItem(index, { openSubmenu = false } = {}) {
    // Clear all focused states across all panels
    for (const item of this.querySelectorAll(".lexxy-block-actions__item--focused")) {
      item.classList.remove("lexxy-block-actions__item--focused")
    }

    const items = this.#menuItems
    if (items.length === 0) return

    this.#focusedIndex = Math.max(0, Math.min(index, items.length - 1))
    const focused = items[this.#focusedIndex]
    focused?.classList.add("lexxy-block-actions__item--focused")
    focused?.scrollIntoView({ block: "nearest" })

    // Auto-open/close submenus when navigating the main panel with keyboard
    if (openSubmenu && !this.#openSubmenuName && focused?.dataset.submenu) {
      this.#openSubmenu(focused.dataset.submenu)
    } else if (openSubmenu && !this.#openSubmenuName && !focused?.dataset.submenu) {
      this.#closeAllSubmenus()
    }
  }

  // -- Click outside ----------------------------------------------------------

  #addClickOutsideListener() {
    this.#clickOutsideHandler = (event) => {
      if (!this.contains(event.target)) this.close()
    }
    // Use setTimeout so the current click that opened the menu doesn't
    // immediately trigger the outside handler.
    setTimeout(() => {
      document.addEventListener("pointerdown", this.#clickOutsideHandler, true)
    }, 0)
  }

  #removeClickOutsideListener() {
    if (this.#clickOutsideHandler) {
      document.removeEventListener("pointerdown", this.#clickOutsideHandler, true)
      this.#clickOutsideHandler = null
    }
  }

  // -- Submenu management -----------------------------------------------------

  #openSubmenu(name, { focusSubmenu = true } = {}) {
    this.#closeAllSubmenus()

    const panel = this.querySelector(`[data-panel="${name}"]`)
    if (!panel) return

    panel.hidden = false
    this.#positionSubmenu(name)

    const trigger = this.querySelector(`[data-submenu="${name}"]`)
    trigger?.classList.add("lexxy-block-actions__item--active")

    if (focusSubmenu) {
      // Enter the submenu — keyboard focus moves into the flyout
      this.#openSubmenuName = name
      this.#focusItem(0)
    }
    // When focusSubmenu is false, the submenu is visible but
    // keyboard focus stays on the main panel trigger item
  }

  #positionSubmenu(name) {
    const panel = this.querySelector(`[data-panel="${name}"]`)
    if (!panel) return

    const trigger = this.querySelector(`[data-submenu="${name}"]`)
    if (!trigger) return

    const triggerRect = trigger.getBoundingClientRect()
    const mainPanel = this.querySelector("[data-panel=\"main\"]")
    const mainRect = mainPanel.getBoundingClientRect()

    // Reset positioning so we can measure the flyout's natural height
    panel.style.top = ""
    panel.style.bottom = ""
    panel.style.maxHeight = ""

    const flyoutHeight = panel.scrollHeight

    // Default: align top of flyout with the trigger row
    let topOffset = triggerRect.top - mainRect.top
    const flyoutTop = mainRect.top + topOffset

    // Clamp: if it would overflow below the viewport, shift it up
    if (flyoutTop + flyoutHeight > window.innerHeight - VIEWPORT_PADDING) {
      topOffset = (window.innerHeight - VIEWPORT_PADDING - flyoutHeight) - mainRect.top
    }
    // Clamp: don't let it go above the viewport
    if (mainRect.top + topOffset < VIEWPORT_PADDING) {
      topOffset = VIEWPORT_PADDING - mainRect.top
    }

    panel.style.top = `${topOffset}px`
    panel.style.bottom = ""

    // Cap max-height to available viewport space from the final top position
    const finalTop = mainRect.top + topOffset
    const availableHeight = window.innerHeight - finalTop - VIEWPORT_PADDING
    panel.style.maxHeight = `${Math.max(availableHeight, 200)}px`
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

  // -- Mouse hover for submenus -----------------------------------------------

  // Ignore mouse events until the user actually moves inside the menu.
  // When the menu opens via Cmd+/, the cursor may already be over an item,
  // firing mouseenter immediately and stealing focus from the keyboard.
  #handleMousemove = (event) => {
    if (this.#mouseActivated) return

    // Only activate once the cursor has actually moved AND is over the menu.
    if (this.#lastMouseX === -1) {
      this.#lastMouseX = event.clientX
      this.#lastMouseY = event.clientY
      return
    }

    if (event.clientX !== this.#lastMouseX || event.clientY !== this.#lastMouseY) {
      // Mouse actually moved — restore cursor everywhere
      this.#editorElement?.classList.remove("lexxy-editor--keyboard-menu")

      // Only activate menu mouse mode if cursor is within menu bounds
      const rect = this.getBoundingClientRect()
      if (event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom) {
        this.#mouseActivated = true
        this.classList.add("lexxy-block-actions--mouse-active")
      }
      this.#lastMouseX = event.clientX
      this.#lastMouseY = event.clientY
    }
  }

  #handleMouseenter = (event) => {
    if (!this.#mouseActivated) return

    const button = event.target.closest("button[role='menuitem']")
    if (!button) return

    // Clear ALL focused states first, then highlight only the hovered item.
    // This ensures only one item across all panels is highlighted at a time.
    for (const item of this.querySelectorAll(".lexxy-block-actions__item--focused")) {
      item.classList.remove("lexxy-block-actions__item--focused")
    }
    button.classList.add("lexxy-block-actions__item--focused")

    // Keep the submenu trigger visually active (different from focused)
    // when hovering inside its submenu — handled by --active class

    const mainPanel = this.querySelector("[data-panel=\"main\"]")
    if (!mainPanel?.contains(button)) return

    if (button.dataset.submenu) {
      // Hovering over a submenu trigger — reveal the flyout but keep
      // keyboard focus on the trigger. Mouse enter on submenu items
      // will update the highlight as the user moves into the flyout.
      const submenuName = button.dataset.submenu
      if (this.#openSubmenuName !== submenuName) {
        this.#openSubmenu(submenuName, { focusSubmenu: false })
      }
    } else {
      // Hovering over a non-submenu item — close any open submenu
      this.#closeAllSubmenus()
    }
  }

  #handleMouseleave = (_event) => {
    // No-op: submenus stay visible until a different item is hovered or the menu closes.
    // This prevents flicker when moving between the trigger and the flyout panel.
  }

  // -- Event handlers ---------------------------------------------------------

  #handleClick = (event) => {
    const button = event.target.closest("button")
    if (!button) return
    if (button.hasAttribute("disabled")) return

    const submenuName = button.dataset.submenu
    if (submenuName) {
      this.#openSubmenu(submenuName)
      return
    }

    if (button.dataset.action === "color") {
      const { style, value } = button.dataset
      saveLastUsedColor({ style, value, label: colorLabel(value, style) })
      this.#onAction?.({ type: "color", style, value })
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

  #deactivateMouse() {
    this.#mouseActivated = false
    this.#lastMouseX = -1
    this.#lastMouseY = -1
    this.classList.remove("lexxy-block-actions--mouse-active")
    this.#editorElement?.classList.add("lexxy-editor--keyboard-menu")

    // Force browser to clear :hover state by triggering a reflow.
    // Changing pointer-events alone doesn't make the browser re-evaluate
    // :hover on elements the cursor is already over.
    this.style.display = "none"
    this.offsetHeight // force reflow
    this.style.display = ""
  }

  #handleKeydown = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        event.stopPropagation()
        this.#deactivateMouse()
        this.#focusItem(this.#focusedIndex + 1)
        break
      case "ArrowUp":
        event.preventDefault()
        event.stopPropagation()
        this.#deactivateMouse()
        this.#focusItem(this.#focusedIndex - 1)
        break
      case "ArrowRight": {
        event.preventDefault()
        event.stopPropagation()
        this.#deactivateMouse()
        if (!this.#openSubmenuName) {
          const items = this.#menuItems
          const focused = items[this.#focusedIndex]
          if (focused?.dataset.submenu) {
            this.#openSubmenu(focused.dataset.submenu)
          }
        }
        break
      }
      case "ArrowLeft":
        event.preventDefault()
        event.stopPropagation()
        this.#deactivateMouse()
        if (this.#openSubmenuName) {
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

export default BlockActionsMenu
