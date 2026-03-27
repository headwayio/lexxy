import Lexxy from "../config/lexxy"
import { createElement, generateDomId, parseHtml } from "../helpers/html_helper"
import { getNonce } from "../helpers/csp_helper"
import { $createParagraphNode, $createTextNode, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, COMMAND_PRIORITY_CRITICAL, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ENTER_COMMAND, KEY_SPACE_COMMAND, KEY_TAB_COMMAND } from "lexical"
import { CustomActionTextAttachmentNode } from "../nodes/custom_action_text_attachment_node"
import InlinePromptSource from "../editor/prompt/inline_source"
import DeferredPromptSource from "../editor/prompt/deferred_source"
import RemoteFilterSource from "../editor/prompt/remote_filter_source"
import { $generateNodesFromDOM } from "@lexical/html"
import { nextFrame } from "../helpers/timing_helpers"

const NOTHING_FOUND_DEFAULT_MESSAGE = "Nothing found"

export class LexicalPromptElement extends HTMLElement {
  constructor() {
    super()
    this.keyListeners = []
    this.showPopoverId = 0
    this.#keyboardFocusTimer = null
  }
  #keyboardFocusTimer = null

  static observedAttributes = [ "connected" ]

  connectedCallback() {
    this.source = this.#createSource()

    this.#addTriggerListener()
    this.toggleAttribute("connected", true)
  }

  disconnectedCallback() {
    this.source = null
    this.popoverElement = null
  }


  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "connected" && this.isConnected && oldValue != null && oldValue !== newValue) {
      requestAnimationFrame(() => this.#reconnect())
    }
  }

  get name() {
    return this.getAttribute("name")
  }

  get trigger() {
    return this.getAttribute("trigger")
  }

  get supportsSpaceInSearches() {
    return this.hasAttribute("supports-space-in-searches")
  }

  get open() {
    return this.popoverElement?.classList?.contains("lexxy-prompt-menu--visible")
  }

  get closed() {
    return !this.open
  }

  get #doesSpaceSelect() {
    return !this.supportsSpaceInSearches
  }

  #createSource() {
    const src = this.getAttribute("src")
    if (src) {
      if (this.hasAttribute("remote-filtering")) {
        return new RemoteFilterSource(src)
      } else {
        return new DeferredPromptSource(src)
      }
    } else {
      return new InlinePromptSource(this.querySelectorAll("lexxy-prompt-item"))
    }
  }

  #addTriggerListener() {
    const unregister = this.#editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        if (this.#selection.isInsideCodeBlock) return

        const { node, offset } = this.#selection.selectedNodeWithOffset()
        if (!node) return

        if ($isTextNode(node)) {
          const fullText = node.getTextContent()
          const triggerLength = this.trigger.length

          // Check if we have enough characters for the trigger
          if (offset >= triggerLength) {
            const textBeforeCursor = fullText.slice(offset - triggerLength, offset)

            // Check if trigger is at the start of the text node (new line case) or preceded by space or newline
            if (textBeforeCursor === this.trigger) {
              const isAtStart = offset === triggerLength

              const charBeforeTrigger = offset > triggerLength ? fullText[offset - triggerLength - 1] : null
              const isPrecededBySpaceOrNewline = charBeforeTrigger === " " || charBeforeTrigger === "\n"

              if (isAtStart || isPrecededBySpaceOrNewline) {
                unregister()
                this.#showPopover()
              }
            }
          }
        }
      })
    })
  }

  #addCursorPositionListener() {
    this.cursorPositionListener = this.#editor.registerUpdateListener(({ editorState }) => {
      if (this.closed) return

      editorState.read(() => {
        if (this.#selection.isInsideCodeBlock) {
          this.#hidePopover()
          return
        }

        const { node, offset } = this.#selection.selectedNodeWithOffset()
        if (!node) return

        if ($isTextNode(node) && offset > 0) {
          const fullText = node.getTextContent()
          const textBeforeCursor = fullText.slice(0, offset)
          const lastTriggerIndex = textBeforeCursor.lastIndexOf(this.trigger)
          const triggerEndIndex = lastTriggerIndex + this.trigger.length - 1

          // If trigger is not found, or cursor is at or before the trigger end position, hide popover
          if (lastTriggerIndex === -1 || offset <= triggerEndIndex) {
            this.#hidePopover()
          }
        } else {
          // Cursor is not in a text node or at offset 0, hide popover
          this.#hidePopover()
        }
      })
    })
  }

  #removeCursorPositionListener() {
    if (this.cursorPositionListener) {
      this.cursorPositionListener()
      this.cursorPositionListener = null
    }
  }

  get #editor() {
    return this.#editorElement.editor
  }

  get #editorElement() {
    return this.closest("lexxy-editor")
  }

  get #selection() {
    return this.#editorElement.selection
  }

  async #showPopover() {
    const showId = ++this.showPopoverId
    this.popoverElement ??= await this.#buildPopover()
    if (this.showPopoverId !== showId) return

    this.#resetPopoverPosition()
    await this.#filterOptions()
    if (this.showPopoverId !== showId) return

    this.popoverElement.classList.toggle("lexxy-prompt-menu--visible", true)
    this.#selectFirstOption()

    this.#editorElement.addEventListener("keydown", this.#handleKeydownOnPopover)
    this.#editorElement.addEventListener("lexxy:change", this.#filterOptions)

    this.#registerKeyListeners()
    this.#addCursorPositionListener()
  }

  #registerKeyListeners() {
    // We can't use a regular keydown for Enter as Lexical handles it first
    this.keyListeners.push(this.#editor.registerCommand(KEY_ENTER_COMMAND, this.#handleSelectedOption.bind(this), COMMAND_PRIORITY_CRITICAL))
    this.keyListeners.push(this.#editor.registerCommand(KEY_TAB_COMMAND, this.#handleSelectedOption.bind(this), COMMAND_PRIORITY_CRITICAL))

    if (this.#doesSpaceSelect) {
      this.keyListeners.push(this.#editor.registerCommand(KEY_SPACE_COMMAND, this.#handleSelectedOption.bind(this), COMMAND_PRIORITY_CRITICAL))
    }

    // Register arrow keys with CRITICAL priority to prevent Lexical's selection handlers from running
    this.keyListeners.push(this.#editor.registerCommand(KEY_ARROW_UP_COMMAND, this.#handleArrowUp.bind(this), COMMAND_PRIORITY_CRITICAL))
    this.keyListeners.push(this.#editor.registerCommand(KEY_ARROW_DOWN_COMMAND, this.#handleArrowDown.bind(this), COMMAND_PRIORITY_CRITICAL))
  }

  #handleArrowUp(event) {
    this.#moveSelectionUp()
    event.preventDefault()
    return true
  }

  #handleArrowDown(event) {
    this.#moveSelectionDown()
    event.preventDefault()
    return true
  }

  #selectFirstOption() {
    const firstOption = this.#listItemElements[0]

    if (firstOption) {
      this.#selectOption(firstOption)
    }
  }

  get #listItemElements() {
    return Array.from(this.popoverElement.querySelectorAll(".lexxy-prompt-menu__item"))
  }

  #selectOption(listItem, direction) {
    this.#clearSelection()
    listItem.toggleAttribute("aria-selected", true)

    // Keyboard navigation sets the outline ring and suppresses hover bg
    if (direction) {
      if (this.#keyboardFocusTimer) clearTimeout(this.#keyboardFocusTimer)
      listItem.toggleAttribute("data-keyboard-focus", true)
      this.popoverElement.classList.add("lexxy-prompt-menu--keyboard-active")
      this.#scrollWithLookahead(listItem, direction)
    } else {
      listItem.scrollIntoView({ block: "nearest" })
    }
    listItem.focus()

    // Preserve selection to prevent cursor jump
    this.#selection.preservingSelection(() => {
      this.#editorElement.focus()
    })

    this.#editorContentElement.setAttribute("aria-controls", this.popoverElement.id)
    this.#editorContentElement.setAttribute("aria-activedescendant", listItem.id)
    this.#editorContentElement.setAttribute("aria-haspopup", "listbox")
  }

  #clearSelection() {
    this.#listItemElements.forEach((item) => {
      item.toggleAttribute("aria-selected", false)
      item.removeAttribute("data-keyboard-focus")
    })
    this.#editorContentElement.removeAttribute("aria-controls")
    this.#editorContentElement.removeAttribute("aria-activedescendant")
    this.#editorContentElement.removeAttribute("aria-haspopup")
  }

  #scrollWithLookahead(listItem, direction = "down") {
    const container = this.popoverElement
    const items = this.#listItemElements
    const index = items.indexOf(listItem)
    const lookahead = 2

    const padding = 6
    const footer = container.querySelector(".lexxy-prompt-menu__footer")
    const footerHeight = footer ? footer.offsetHeight + 8 : 0
    const containerRect = container.getBoundingClientRect()
    const visibleTop = containerRect.top + padding
    const visibleBottom = containerRect.bottom - footerHeight

    // First ensure the selected item itself is visible
    if (index === 0) {
      container.scrollTop = 0
    } else {
      const itemRect = listItem.getBoundingClientRect()
      if (itemRect.top < visibleTop) {
        container.scrollTop -= visibleTop - itemRect.top
      } else if (itemRect.bottom > visibleBottom) {
        container.scrollTop += itemRect.bottom - visibleBottom
      }
    }

    // Then scroll the lookahead target into view
    const targetIndex = direction === "down"
      ? Math.min(index + lookahead, items.length - 1)
      : Math.max(index - lookahead, 0)

    // When near the top, scroll all the way to reveal section headers
    if (direction === "up" && targetIndex <= 1) {
      container.scrollTop = 0
    } else if (direction === "down" && targetIndex >= items.length - 2) {
      container.scrollTop = container.scrollHeight
    } else {
      const target = items[targetIndex]
      if (target && target !== listItem) {
        const targetRect = target.getBoundingClientRect()
        if (direction === "down" && targetRect.bottom > visibleBottom) {
          container.scrollTop += targetRect.bottom - visibleBottom
        } else if (direction === "up" && targetRect.top < visibleTop) {
          container.scrollTop -= visibleTop - targetRect.top
        }
      }
    }

    this.#updateScrollFades()
  }

  #updateScrollFades() {
    const container = this.popoverElement
    if (!container) return

    const atTop = container.scrollTop <= 1
    const footer = container.querySelector(".lexxy-prompt-menu__footer")
    const footerHeight = footer ? footer.offsetHeight + 4 : 0
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - footerHeight

    container.classList.toggle("lexxy-prompt-menu--fade-top", !atTop)
    container.classList.toggle("lexxy-prompt-menu--fade-bottom", !atBottom)
  }

  #positionPopover() {
    const { x, y, fontSize } = this.#selection.cursorPosition
    const rootRect = this.#editorContentElement.getBoundingClientRect()

    // Convert editor-relative coords to viewport coords for position: fixed
    const viewportX = rootRect.left + x
    const viewportY = rootRect.top + y

    if (!this.popoverElement.hasAttribute("data-anchored")) {
      this.#setPopoverOffsetX(viewportX)
      this.#setPopoverOffsetY(viewportY)
      this.popoverElement.toggleAttribute("data-anchored", true)
    }

    const popoverRect = this.popoverElement.getBoundingClientRect()

    // Clamp to viewport right edge
    if (popoverRect.right > window.innerWidth) {
      this.#setPopoverOffsetX(Math.max(8, window.innerWidth - popoverRect.width - 8))
    }

    // Flip above cursor if it would overflow viewport bottom
    const flippedGap = fontSize * 3
    if (popoverRect.bottom > window.innerHeight) {
      this.popoverElement.toggleAttribute("data-flipped", true)
      this.#setPopoverOffsetY(viewportY - popoverRect.height - flippedGap)
    }

    // When flipped above cursor, recalculate top so the bottom edge
    // stays anchored to the cursor as the menu height changes (filtering)
    if (this.popoverElement.hasAttribute("data-flipped")) {
      const flippedTop = viewportY - this.popoverElement.offsetHeight - flippedGap
      this.#setPopoverOffsetY(Math.max(8, flippedTop))
    }
  }

  #setPopoverOffsetX(value) {
    this.popoverElement.style.setProperty("--lexxy-prompt-offset-x", `${value}px`)
  }

  #setPopoverOffsetY(value) {
    this.popoverElement.style.setProperty("--lexxy-prompt-offset-y", `${value}px`)
  }

  #resetPopoverPosition() {
    this.popoverElement.removeAttribute("data-clipped-at-bottom")
    this.popoverElement.removeAttribute("data-clipped-at-right")
    this.popoverElement.removeAttribute("data-anchored")
    this.popoverElement.removeAttribute("data-flipped")
  }

  async #hidePopover() {
    this.showPopoverId++
    this.#clearSelection()
    this.popoverElement.classList.toggle("lexxy-prompt-menu--visible", false)
    this.#editorElement.removeEventListener("lexxy:change", this.#filterOptions)
    this.#editorElement.removeEventListener("keydown", this.#handleKeydownOnPopover)

    this.#unregisterKeyListeners()
    this.#removeCursorPositionListener()

    await nextFrame()
    this.#addTriggerListener()
  }

  #unregisterKeyListeners() {
    this.keyListeners.forEach((unregister) => unregister())
    this.keyListeners = []
  }

  #filterOptions = async () => {
    if (this.initialPrompt) {
      this.initialPrompt = false
      return
    }

    if (this.#editorContents.containsTextBackUntil(this.trigger)) {
      await this.#showFilteredOptions()

      // Re-check after async operation — the trigger may have been consumed
      // (e.g. markdown heading shortcut converted "# " to h1 during the fetch)
      if (!this.#editorContents.containsTextBackUntil(this.trigger)) {
        this.#hidePopover()
        return
      }

      await nextFrame()
      this.#positionPopover()
    } else {
      this.#hidePopover()
    }
  }

  async #showFilteredOptions() {
    const showId = this.showPopoverId
    const filter = this.#editorContents.textBackUntil(this.trigger)
    const filteredListItems = await this.source.buildListItems(filter)
    if (this.showPopoverId !== showId) return
    if (!this.#editorContents.containsTextBackUntil(this.trigger)) return

    this.popoverElement.innerHTML = ""

    if (filteredListItems.length > 0) {
      this.#showResults(filteredListItems)
    } else {
      this.#showEmptyResults()
    }
    this.#selectFirstOption()
  }

  #showResults(filteredListItems) {
    this.popoverElement.classList.remove("lexxy-prompt-menu--empty")
    this.popoverElement.append(...filteredListItems)
    if (this.hasAttribute("dispatch-command")) {
      this.popoverElement.appendChild(this.#buildFooter())
    }
    this.popoverElement.scrollTop = 0
    requestAnimationFrame(() => this.#updateScrollFades())
  }

  #buildFooter() {
    const footer = createElement("li", { role: "presentation" })
    footer.classList.add("lexxy-prompt-menu__footer")
    footer.innerHTML = "<span>Close menu</span><span class=\"lexxy-prompt-menu__footer-key\">esc</span>"
    return footer
  }

  #showEmptyResults() {
    this.popoverElement.classList.add("lexxy-prompt-menu--empty")
    const el = createElement("li", { innerHTML: this.#emptyResultsMessage })
    el.classList.add("lexxy-prompt-menu__item--empty")
    this.popoverElement.append(el)
  }

  get #emptyResultsMessage() {
    return this.getAttribute("empty-results") || NOTHING_FOUND_DEFAULT_MESSAGE
  }

  #handleKeydownOnPopover = (event) => {
    if (event.key === "Escape") {
      this.#hidePopover()
      this.#editorElement.focus()
      event.stopPropagation()
    } else if (event.key === ",") {
      event.preventDefault()
      event.stopPropagation()
      this.#optionWasSelected()
      this.#editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selection.insertText(",")
        }
      })
    }
    // Arrow keys are now handled via Lexical commands with HIGH priority
  }

  #moveSelectionDown() {
    const nextIndex = this.#selectedIndex + 1
    if (nextIndex < this.#listItemElements.length) this.#selectOption(this.#listItemElements[nextIndex], "down")
  }

  #moveSelectionUp() {
    const previousIndex = this.#selectedIndex - 1
    if (previousIndex >= 0) this.#selectOption(this.#listItemElements[previousIndex], "up")
  }

  get #selectedIndex() {
    return this.#listItemElements.findIndex((item) => item.hasAttribute("aria-selected"))
  }

  get #selectedListItem() {
    return this.#listItemElements[this.#selectedIndex]
  }

  #handleSelectedOption(event) {
    event.preventDefault()
    event.stopPropagation()
    this.#optionWasSelected()
    return true
  }

  #optionWasSelected() {
    this.#replaceTriggerWithSelectedItem()
    this.#hidePopover()
    this.#editorElement.focus()
  }

  #replaceTriggerWithSelectedItem() {
    const promptItem = this.source.promptItemFor(this.#selectedListItem)

    if (!promptItem) { return }

    const stringToReplace = `${this.trigger}${this.#editorContents.textBackUntil(this.trigger)}`

    if (this.hasAttribute("dispatch-command")) {
      this.#dispatchCommandFromPromptItem(promptItem, stringToReplace)
    } else {
      const templates = Array.from(promptItem.querySelectorAll("template[type='editor']"))

      if (this.hasAttribute("insert-editable-text")) {
        this.#insertTemplatesAsEditableText(templates, stringToReplace)
      } else {
        this.#insertTemplatesAsAttachments(templates, stringToReplace, promptItem.getAttribute("sgid"))
      }
    }
  }

  #dispatchCommandFromPromptItem(promptItem, stringToReplace) {
    const command = promptItem.getAttribute("data-command")
    if (!command) return

    const payloadStr = promptItem.getAttribute("data-command-payload")
    const payload = payloadStr ? JSON.parse(payloadStr) : undefined
    const selectBlock = promptItem.hasAttribute("data-command-select-block")
    const insertBelow = promptItem.hasAttribute("data-insert-below")

    this.#editor.update(() => {
      this.#editorContents.replaceTextBackUntil(stringToReplace, [ $createTextNode("") ])
    })

    requestAnimationFrame(() => {
      this.#editor.update(() => {
        this.#removeTrailingWhitespaceNode()

        if (insertBelow) {
          this.#insertNewBlockBelow()
        } else if (selectBlock) {
          const sel = $getSelection()
          if ($isRangeSelection(sel)) {
            const node = sel.anchor.getNode()
            const block = $isElementNode(node) ? node : node.getParentOrThrow()
            block.select(0, block.getChildrenSize())
            this.#editor.dispatchCommand(command, payload)
            // Collapse selection to end so cursor stays inside the styled text
            const afterSel = $getSelection()
            if ($isRangeSelection(afterSel)) {
              afterSel.anchor.set(afterSel.focus.key, afterSel.focus.offset, afterSel.focus.type)
            }
            return
          }
        }
        this.#editor.dispatchCommand(command, payload)
      })
    })
  }

  #insertNewBlockBelow() {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    const anchorNode = selection.anchor.getNode()
    const topLevelElement = anchorNode.getTopLevelElementOrThrow()

    // Always insert below when inside a list, or when the block has content
    const isListBlock = topLevelElement.getType() === "list"
    const blockHasContent = topLevelElement.getTextContent().trim() !== ""

    if (isListBlock || blockHasContent) {
      const newParagraph = $createParagraphNode()
      topLevelElement.insertAfter(newParagraph)
      newParagraph.selectStart()
    }
    // Otherwise, the command will convert the current empty block in place
  }

  #removeTrailingWhitespaceNode() {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    const anchorNode = selection.anchor.getNode()
    if ($isTextNode(anchorNode) && anchorNode.getTextContent().trim() === "") {
      anchorNode.setTextContent("")
      anchorNode.select(0, 0)
    }
  }

  #insertTemplatesAsEditableText(templates, stringToReplace) {
    this.#editor.update(() => {
      const nodes = templates.flatMap(template => this.#buildEditableTextNodes(template))
      this.#editorContents.replaceTextBackUntil(stringToReplace, nodes)
    })
  }

  #buildEditableTextNodes(template) {
    return $generateNodesFromDOM(this.#editor, parseHtml(`${template.innerHTML}`))
  }

  #insertTemplatesAsAttachments(templates, stringToReplace, fallbackSgid = null) {
    this.#editor.update(() => {
      const attachmentNodes = this.#buildAttachmentNodes(templates, fallbackSgid)
      const spacedAttachmentNodes = attachmentNodes.flatMap(node => [ node, this.#getSpacerTextNode() ]).slice(0, -1)
      this.#editorContents.replaceTextBackUntil(stringToReplace, spacedAttachmentNodes)
    })
  }

  #buildAttachmentNodes(templates, fallbackSgid = null) {
    return templates.map(
      template => this.#buildAttachmentNode(
        template.innerHTML,
        template.getAttribute("content-type") || this.#defaultPromptContentType,
        template.getAttribute("sgid") || fallbackSgid
      ))
  }

  #getSpacerTextNode() {
    return $createTextNode(" ")
  }

  get #defaultPromptContentType() {
    const attachmentContentTypeNamespace = Lexxy.global.get("attachmentContentTypeNamespace")
    return `application/vnd.${attachmentContentTypeNamespace}.${this.name}`
  }

  #buildAttachmentNode(innerHtml, contentType, sgid) {
    return new CustomActionTextAttachmentNode({ sgid, contentType, innerHtml })
  }

  get #editorContents() {
    return this.#editorElement.contents
  }

  get #editorContentElement() {
    return this.#editorElement.editorContentElement
  }

  async #buildPopover() {
    const popoverContainer = createElement("ul", { role: "listbox", id: generateDomId("prompt-popover") }) // Avoiding [popover] due to not being able to position at an arbitrary X, Y position.
    popoverContainer.classList.add("lexxy-prompt-menu")
    popoverContainer.style.position = "fixed"
    popoverContainer.setAttribute("nonce", getNonce())
    popoverContainer.append(...await this.source.buildListItems())
    popoverContainer.addEventListener("click", this.#handlePopoverClick)
    popoverContainer.addEventListener("mousemove", this.#handlePopoverMousemove)
    popoverContainer.addEventListener("scroll", this.#handlePopoverScroll, { passive: true })
    this.#editorElement.appendChild(popoverContainer)
    return popoverContainer
  }

  #handlePopoverClick = (event) => {
    if (event.target.closest(".lexxy-prompt-menu__footer")) {
      this.#hidePopover()
      this.#editorElement.focus()
      return
    }

    const listItem = event.target.closest(".lexxy-prompt-menu__item")
    if (listItem) {
      this.#selectOption(listItem)
      this.#optionWasSelected()
    }
  }

  #handlePopoverMousemove = (event) => {
    this.popoverElement.classList.remove("lexxy-prompt-menu--keyboard-active")

    const listItem = event.target.closest(".lexxy-prompt-menu__item")
    if (!listItem || listItem.hasAttribute("aria-selected")) return

    // Clear keyboard focus outline after a short delay when mouse moves to a different item
    if (this.#keyboardFocusTimer) clearTimeout(this.#keyboardFocusTimer)
    const currentKeyboardItem = this.popoverElement.querySelector("[data-keyboard-focus]")
    if (currentKeyboardItem && currentKeyboardItem !== listItem) {
      this.#keyboardFocusTimer = setTimeout(() => {
        currentKeyboardItem.removeAttribute("data-keyboard-focus")
      }, 500)
    }

    // Silently update selection tracking so keyboard continues from here
    this.#clearSelection()
    listItem.toggleAttribute("aria-selected", true)
    this.#editorContentElement.setAttribute("aria-activedescendant", listItem.id)
  }

  #handlePopoverScroll = () => {
    this.#updateScrollFades()
  }

  #reconnect() {
    this.disconnectedCallback()
    this.connectedCallback()
  }
}

export default LexicalPromptElement
