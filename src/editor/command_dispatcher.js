import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  SELECT_ALL_COMMAND,
  UNDO_COMMAND
} from "lexical"
import { CodeNode } from "@lexical/code"
import { $createAutoLinkNode, $toggleLink, LinkNode } from "@lexical/link"
import { $getNearestNodeOfType, $insertNodeToNearestRoot } from "@lexical/utils"
import { INSERT_TABLE_COMMAND } from "@lexical/table"

import { createElement } from "../helpers/html_helper"
import { ListenerBin, registerEventListener } from "../helpers/listener_helper"
import { $normalizeBlockContainerSelection, getListType } from "../helpers/lexical_helper"
import { HorizontalDividerNode } from "../nodes/horizontal_divider_node"
import { REMOVE_HIGHLIGHT_COMMAND, TOGGLE_HIGHLIGHT_COMMAND } from "../extensions/highlight_extension"

const COMMANDS = [
  "bold",
  "italic",
  "strikethrough",
  "underline",
  "link",
  "unlink",
  "toggleHighlight",
  "removeHighlight",
  "setFormatHeadingLarge",
  "setFormatHeadingMedium",
  "setFormatHeadingSmall",
  "setFormatParagraph",
  "applyHeadingFormat",
  "clearFormatting",
  "insertUnorderedList",
  "insertOrderedList",
  "insertQuoteBlock",
  "insertCodeBlock",
  "setCodeLanguage",
  "insertHorizontalDivider",
  "uploadImage",
  "uploadFile",

  "insertTable",

  "undo",
  "redo"
]

// Commands that replace DOM elements or restore a prior editor state,
// both of which trigger Lexical's scrollIntoViewIfNeeded and cause the
// page to jump. These get scroll preservation.
const BLOCK_FORMAT_COMMANDS = new Set([
  "setFormatHeadingLarge", "setFormatHeadingMedium", "setFormatHeadingSmall",
  "setFormatParagraph", "insertUnorderedList", "insertOrderedList",
  "insertQuoteBlock", "insertCodeBlock",
  "undo", "redo"
])

export class CommandDispatcher {
  #selectionBeforeDrag = null
  #listeners = new ListenerBin()

  static configureFor(editorElement) {
    return new CommandDispatcher(editorElement)
  }

  constructor(editorElement) {
    this.editorElement = editorElement
    this.editor = editorElement.editor
    this.selection = editorElement.selection
    this.contents = editorElement.contents

    this.#registerCommands()
    this.#registerKeyboardCommands()
    this.#registerDragAndDropHandlers()
  }

  dispatchBold() {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")
  }

  dispatchItalic() {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")
  }

  dispatchStrikethrough() {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
  }

  dispatchUnderline() {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")
  }

  dispatchToggleHighlight(styles) {
    this.editor.dispatchCommand(TOGGLE_HIGHLIGHT_COMMAND, styles)
  }

  dispatchRemoveHighlight() {
    this.editor.dispatchCommand(REMOVE_HIGHLIGHT_COMMAND)
  }

  dispatchLink(url) {
    this.editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      const anchorNode = selection.anchor.getNode()

      if (selection.isCollapsed() && !$getNearestNodeOfType(anchorNode, LinkNode)) {
        const autoLinkNode = $createAutoLinkNode(url)
        const textNode = $createTextNode(url)
        autoLinkNode.append(textNode)
        selection.insertNodes([ autoLinkNode ])
      } else {
        $toggleLink(url)
      }
    })
  }

  dispatchUnlink() {
    this.editor.update(() => {
      // Let adapters signal whether unlink should target a frozen link key.
      if (this.editorElement.adapter.unlinkFrozenNode?.()) {
        return
      }

      $toggleLink(null)
    })
  }

  dispatchInsertUnorderedList() {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    const anchorNode = selection.anchor.getNode()

    if (this.selection.isInsideList && anchorNode && getListType(anchorNode) === "bullet") {
      this.contents.applyParagraphFormat()
    } else {
      this.contents.applyUnorderedListFormat()
    }
  }

  dispatchInsertOrderedList() {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    const anchorNode = selection.anchor.getNode()

    if (this.selection.isInsideList && anchorNode && getListType(anchorNode) === "number") {
      this.contents.applyParagraphFormat()
    } else {
      this.contents.applyOrderedListFormat()
    }
  }

  dispatchInsertQuoteBlock() {
    this.contents.toggleBlockquote()
  }

  dispatchInsertCodeBlock() {
    if (this.selection.hasSelectedWordsInSingleLine) {
      this.#toggleInlineCode()
    } else {
      this.contents.toggleCodeBlock()
    }
  }

  #toggleInlineCode() {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    if (!selection.isCollapsed()) {
      const textNodes = selection.getNodes().filter($isTextNode)
      const applyingCode = !textNodes.every((node) => node.hasFormat("code"))

      if (applyingCode) {
        this.#stripInlineFormattingFromSelection(selection, textNodes)
      }
    }

    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")
  }

  // Strip all inline formatting (bold, italic, etc.) from the selected text
  // nodes so that applying code produces a single merged <code> element instead
  // of one per differently-formatted span.
  #stripInlineFormattingFromSelection(selection, textNodes) {
    const isBackward = selection.isBackward()
    const startPoint = isBackward ? selection.focus : selection.anchor
    const endPoint = isBackward ? selection.anchor : selection.focus

    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i]
      if (node.getFormat() === 0) continue

      const isFirst = i === 0
      const isLast = i === textNodes.length - 1
      const startOffset = isFirst && startPoint.type === "text" ? startPoint.offset : 0
      const endOffset = isLast && endPoint.type === "text" ? endPoint.offset : node.getTextContentSize()

      if (startOffset === 0 && endOffset === node.getTextContentSize()) {
        node.setFormat(0)
      } else {
        const splits = node.splitText(startOffset, endOffset)
        const target = startOffset === 0 ? splits[0] : splits[1]
        target.setFormat(0)

        if (isFirst && startPoint.type === "text") {
          startPoint.set(target.getKey(), 0, "text")
        }
        if (isLast && endPoint.type === "text") {
          endPoint.set(target.getKey(), endOffset - startOffset, "text")
        }
      }
    }
  }

  dispatchSetCodeLanguage(language) {
    this.editor.update(() => {
      if (!this.selection.isInsideCodeBlock) return

      const codeNode = this.selection.nearestNodeOfType(CodeNode)
      if (!codeNode) return

      codeNode.setLanguage(language)
    })
  }

  dispatchInsertHorizontalDivider() {
    $insertNodeToNearestRoot(new HorizontalDividerNode)
  }

  dispatchSetFormatHeadingLarge() {
    this.#applyConfiguredHeadingFormat(0)
  }

  dispatchSetFormatHeadingMedium() {
    this.#applyConfiguredHeadingFormat(1)
  }

  dispatchSetFormatHeadingSmall() {
    this.#applyConfiguredHeadingFormat(2)
  }

  dispatchSetFormatParagraph() {
    this.contents.applyParagraphFormat()
  }

  dispatchApplyHeadingFormat(tag) {
    this.contents.applyHeadingFormat(tag)
  }

  dispatchClearFormatting() {
    this.contents.clearFormatting()
  }

  dispatchUploadImage() {
    this.#dispatchUploadAttachment("image/*,video/*")
  }

  dispatchUploadFile() {
    this.#dispatchUploadAttachment()
  }

  #dispatchUploadAttachment(accept = null) {
    const attributes = {
      type: "file",
      multiple: true,
      style: "display: none;",
      onchange: ({ target: { files } }) => {
        this.contents.uploadFiles(files, { selectLast: true })
      }
    }

    if (accept) attributes.accept = accept

    const input = createElement("input", attributes)

    // Append and remove to make testable
    this.editorElement.appendChild(input)
    input.click()
    setTimeout(() => input.remove(), 1000)
  }

  dispatchInsertTable() {
    this.editor.dispatchCommand(INSERT_TABLE_COMMAND, { "rows": 3, "columns": 3, "includeHeaders": true })
  }

  dispatchUndo() {
    this.editor.dispatchCommand(UNDO_COMMAND, undefined)
  }

  dispatchRedo() {
    this.editor.dispatchCommand(REDO_COMMAND, undefined)
  }

  dispose() {
    this.#listeners.dispose()
  }

  #applyConfiguredHeadingFormat(index) {
    const tag = this.editorElement.config.get("headings")[index]
    if (tag) this.contents.applyHeadingFormat(tag)
  }

  #registerCommands() {
    for (const command of COMMANDS) {
      const methodName = `dispatch${capitalize(command)}`
      let handler = this[methodName].bind(this)

      if (BLOCK_FORMAT_COMMANDS.has(command)) {
        handler = withPreservedScroll(handler)
      }

      this.#registerCommandHandler(command, 0, handler)
    }

    this.#registerCommandHandler(SELECT_ALL_COMMAND, COMMAND_PRIORITY_NORMAL, this.#handleSelectAll.bind(this))

    // Keyboard Cmd+Z / Cmd+Shift+Z bypass the COMMANDS string-dispatch and go
    // straight to Lexical's UNDO_COMMAND / REDO_COMMAND. Register HIGH-priority
    // handlers on those commands too so the scroll position is preserved
    // regardless of whether undo was triggered from the toolbar button or the
    // keyboard shortcut. Returning false lets Lexical's history plugin still
    // run at normal priority.
    for (const cmd of [ UNDO_COMMAND, REDO_COMMAND ]) {
      this.#registerCommandHandler(cmd, COMMAND_PRIORITY_HIGH, () => {
        const y = window.scrollY
        queueMicrotask(() => window.scrollTo(window.scrollX, y))
        return false
      })
    }
  }

  #registerCommandHandler(command, priority, handler) {
    this.#listeners.track(this.editor.registerCommand(command, handler, priority))
  }

  #registerKeyboardCommands() {
    this.#registerCommandHandler(KEY_ARROW_RIGHT_COMMAND, COMMAND_PRIORITY_NORMAL, this.#handleArrowRightKey.bind(this))
    this.#registerCommandHandler(KEY_TAB_COMMAND, COMMAND_PRIORITY_NORMAL, this.#handleTabKey.bind(this))

    // Run before Lexical's built-in insert handlers to descend an element point on a
    // block container to a leaf, avoiding error #211 on Enter / Shift+Enter in a quote.
    this.#registerCommandHandler(INSERT_LINE_BREAK_COMMAND, COMMAND_PRIORITY_HIGH, this.#normalizeBlockContainerSelection.bind(this))
    this.#registerCommandHandler(INSERT_PARAGRAPH_COMMAND, COMMAND_PRIORITY_HIGH, this.#normalizeBlockContainerSelection.bind(this))
  }

  #normalizeBlockContainerSelection() {
    $normalizeBlockContainerSelection()
    return false
  }

  #handleArrowRightKey(event) {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
    if (this.selection.isInsideCodeBlock || !selection.hasFormat("code")) return false

    const anchorNode = selection.anchor.getNode()
    if (!$isTextNode(anchorNode) || selection.anchor.offset !== anchorNode.getTextContentSize()) return false
    if (anchorNode.getNextSibling() !== null) return false

    event.preventDefault()
    selection.toggleFormat("code")
    return true
  }

  #registerDragAndDropHandlers() {
    if (this.editorElement.supportsAttachments) {
      this.dragCounter = 0
      this.#listeners.track(
        this.editor.registerRootListener((rootElement) => {
          if (rootElement) {
            const teardowns = [
              registerEventListener(rootElement, "dragover", this.#handleDragOver.bind(this)),
              registerEventListener(rootElement, "drop", this.#handleDrop.bind(this)),
              registerEventListener(rootElement, "dragenter", this.#handleDragEnter.bind(this)),
              registerEventListener(rootElement, "dragleave", this.#handleDragLeave.bind(this))
            ]
            return () => teardowns.forEach((teardown) => teardown())
          }
        })
      )
    }
  }

  #handleDragEnter(event) {
    if (this.#isInternalDrag(event)) return

    this.dragCounter++
    if (this.dragCounter === 1) {
      this.#saveSelectionBeforeDrag()
      this.editor.getRootElement().classList.add("lexxy-editor--drag-over")
    }
  }

  #handleDragLeave(event) {
    if (this.#isInternalDrag(event)) return

    this.dragCounter--
    if (this.dragCounter === 0) {
      this.#selectionBeforeDrag = null
      this.editor.getRootElement().classList.remove("lexxy-editor--drag-over")
    }
  }

  #handleDragOver(event) {
    if (this.#isInternalDrag(event)) return

    event.preventDefault()
  }

  #handleDrop(event) {
    if (this.#isInternalDrag(event)) return

    event.preventDefault()

    this.dragCounter = 0
    this.editor.getRootElement().classList.remove("lexxy-editor--drag-over")

    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return

    const files = Array.from(dataTransfer.files)
    if (!files.length) return

    this.#restoreSelectionBeforeDrag()
    this.contents.uploadFiles(files, { selectLast: true })

    this.editor.focus()
  }

  #saveSelectionBeforeDrag() {
    this.editor.getEditorState().read(() => {
      this.#selectionBeforeDrag = $getSelection()?.clone()
    })
  }

  #restoreSelectionBeforeDrag() {
    if (!this.#selectionBeforeDrag) return

    this.editor.update(() => {
      $setSelection(this.#selectionBeforeDrag)
    })

    this.#selectionBeforeDrag = null
  }

  #isInternalDrag(event) {
    return event.dataTransfer?.types.some((type) => type.startsWith("application/x-lexxy-"))
  }

  #handleTabKey(event) {
    if (this.selection.isInsideCodeBlock) {
      return this.#handleTabForCode(event)
    } else if (this.selection.isInsideList) {
      return this.#handleTabForList(event)
    }
    return false
  }

  #handleTabForList(event) {
    if (event.shiftKey && !this.selection.isIndentedList) return false

    event.preventDefault()
    const command = event.shiftKey? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND
    return this.editor.dispatchCommand(command)
  }

  #handleTabForCode(event) {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return false

    event.preventDefault()

    if (event.shiftKey) {
      this.#outdentCodeLine(selection)
    } else {
      this.editor.update(() => {
        selection.insertText("\t")
      })
    }

    return true
  }

  #handleSelectAll(event) {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return false

    // If the entire document is already selected, escalate to block select mode.
    // Check if selection spans from the root's first to last position.
    if (!selection.isCollapsed()) {
      const root = $getRoot()
      const { anchor, focus } = selection
      const first = root.getFirstDescendant()
      const last = root.getLastDescendant()
      const isAtStart = first && (anchor.key === first.getKey() && anchor.offset === 0
        || anchor.key === root.getKey() && anchor.offset === 0)
      const lastSize = last?.getTextContentSize?.() ?? root.getChildrenSize()
      const isAtEnd = last && (focus.key === last.getKey() && focus.offset === lastSize
        || focus.key === root.getKey() && focus.offset === root.getChildrenSize())
      if (isAtStart && isAtEnd) {
        event.preventDefault()
        this.editorElement.selectAllBlocks?.()
        return true
      }
    }

    // Inside a code block: first Cmd+A selects code content,
    // second escalates to block select
    if (this.selection.isInsideCodeBlock) {
      const anchorNode = selection.anchor.getNode()
      let codeNode = anchorNode
      while (codeNode && !(codeNode instanceof CodeNode)) {
        codeNode = codeNode.getParent()
      }
      if (codeNode) {
        const codeText = codeNode.getTextContent()
        const selectedText = selection.getTextContent()
        if (selectedText === codeText && !selection.isCollapsed()) {
          event.preventDefault()
          this.editorElement.selectAllBlocks?.()
          return true
        }

        event.preventDefault()
        codeNode.select(0, codeNode.getChildrenSize())
        return true
      }
    }

    return false
  }

  #outdentCodeLine(selection) {
    this.editor.update(() => {
      const anchor = selection.anchor
      const node = anchor.getNode()
      if (!$isTextNode(node)) return

      const text = node.getTextContent()
      if (text.startsWith("\t")) {
        // Remove leading tab
        const updated = node.getWritable()
        updated.setTextContent(text.slice(1))
        // Adjust cursor position
        const newOffset = Math.max(0, anchor.offset - 1)
        selection.anchor.set(node.getKey(), newOffset, "text")
        selection.focus.set(node.getKey(), newOffset, "text")
      }
    })
  }

}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// Wraps a handler so the page scroll position is saved before and restored
// after Lexical's DOM reconciliation (which calls scrollIntoViewIfNeeded).
// The microtask fires after reconciliation but before the browser repaints.
function withPreservedScroll(handler) {
  return (...args) => {
    const y = window.scrollY
    const result = handler(...args)
    queueMicrotask(() => window.scrollTo(window.scrollX, y))
    return result
  }
}
