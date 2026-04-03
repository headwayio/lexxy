import { $createParagraphNode, $getSelection, $isParagraphNode, $isRangeSelection, $isTextNode, $splitNode, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_NORMAL, INSERT_PARAGRAPH_COMMAND, KEY_ARROW_DOWN_COMMAND, KEY_SPACE_COMMAND, ParagraphNode, defineExtension } from "lexical"
import { CodeNode } from "@lexical/code"
import { $isListItemNode, ListItemNode } from "@lexical/list"
import { $isQuoteNode } from "@lexical/rich-text"
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils"
import { EarlyEscapeCodeNode } from "../nodes/early_escape_code_node"
import { EarlyEscapeListItemNode } from "../nodes/early_escape_list_item_node"
import { $isBlankNode, $isCursorOnLastLine, $trimTrailingBlankNodes, extendConversion } from "../helpers/lexical_helper"
import LexxyExtension from "./lexxy_extension"

export class FormatEscapeExtension extends LexxyExtension {

  get enabled() {
    return this.editorElement.supportsRichText
  }

  get lexicalExtension() {
    const mixedLists = this.editorElement.supportsMixedLists

    const htmlImport = { }
    if (mixedLists) {
      htmlImport.li = (element) => {
        if (!element.dataset?.listItemType) return null
        return {
          conversion: extendConversion(ListItemNode, "li", $applyListItemType),
          priority: 1
        }
      }
    }

    return defineExtension({
      name: "lexxy/format-escape",
      nodes: [
        EarlyEscapeCodeNode,
        { replace: CodeNode, with: (node) => new EarlyEscapeCodeNode(node.getLanguage()), withKlass: EarlyEscapeCodeNode },
        EarlyEscapeListItemNode,
        { replace: ListItemNode, with: (node) => {
          const replacement = new EarlyEscapeListItemNode(node.__value, node.__checked)
          if (mixedLists && node.__listItemType) replacement.setListItemType(node.__listItemType)
          return replacement
        }, withKlass: EarlyEscapeListItemNode },
      ],
      html: { import: htmlImport },
      register(editor) {
        const registrations = [
          editor.registerCommand(
            INSERT_PARAGRAPH_COMMAND,
            () => $escapeFromBlockquote(),
            COMMAND_PRIORITY_HIGH
          ),
          editor.registerCommand(
            KEY_ARROW_DOWN_COMMAND,
            (event) => $handleArrowDownInCodeBlock(event),
            COMMAND_PRIORITY_NORMAL
          )
        ]

        if (mixedLists) {
          registrations.push(
            editor.registerCommand(KEY_SPACE_COMMAND, () => {
              return $toggleListItemTypeOnSpace()
            }, COMMAND_PRIORITY_HIGH)
          )
        }

        return mergeRegister(...registrations)
      }
    })
  }
}

function $escapeFromBlockquote() {
  const anchorNode = $getSelection().anchor.getNode()

  const paragraph = $getNearestNodeOfType(anchorNode, ParagraphNode)
  if (!paragraph || !$isBlankNode(paragraph)) return false

  const blockquote = paragraph.getParent()
  if (!blockquote || !$isQuoteNode(blockquote)) return false

  const nonEmptySiblings = paragraph.getNextSiblings().filter(sibling => !$isBlankNode(sibling))

  if (nonEmptySiblings.length > 0) {
    $splitQuoteNode(blockquote, paragraph)
  } else {
    blockquote.insertAfter(paragraph)
    paragraph.selectStart()
  }

  return true
}

function $splitQuoteNode(node, paragraph) {
  const splitQuotes = $splitNode(node, paragraph.getIndexWithinParent())
  splitQuotes[0].insertAfter(paragraph)
  splitQuotes.forEach($trimTrailingBlankNodes)
  paragraph.selectEnd()
}

function $applyListItemType(conversionOutput, element) {
  const listItemType = element.dataset.listItemType
  if (listItemType === "bullet" || listItemType === "number") {
    conversionOutput.node.setListItemType?.(listItemType)
  }
}

const BULLET_TRIGGER = /^[-*+]$/
const NUMBER_TRIGGER = /^\d{1,}\.$/

// Called only when space is typed. Checks if the text before the cursor
// matches a list type trigger (e.g., "- " or "1. ") and toggles the
// list item type accordingly. Uses INSERT_TEXT_COMMAND instead of a
// TextNode transform to avoid running on every text mutation.
function $toggleListItemTypeOnSpace() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

  const anchor = selection.anchor.getNode()
  if (!$isTextNode(anchor)) return false

  const parent = anchor.getParent()
  let listItem
  if ($isListItemNode(parent)) {
    listItem = parent
  } else if ($isParagraphNode(parent) && $isListItemNode(parent.getParent())) {
    listItem = parent.getParent()
  } else {
    return false
  }

  if (!listItem.getEffectiveListType) return false
  if (parent.getFirstChild() !== anchor) return false

  // Text content before the space is inserted
  const text = anchor.getTextContent().slice(0, selection.anchor.offset)
  const effectiveType = listItem.getEffectiveListType()

  if (effectiveType === "number" && BULLET_TRIGGER.test(text)) {
    listItem.setListItemType("bullet")
    anchor.setTextContent(anchor.getTextContent().slice(selection.anchor.offset))
    anchor.select(0, 0)
    return true // consume the space
  } else if (effectiveType === "bullet" && NUMBER_TRIGGER.test(text)) {
    listItem.setListItemType("number")
    anchor.setTextContent(anchor.getTextContent().slice(selection.anchor.offset))
    anchor.select(0, 0)
    return true
  }

  return false
}

function $handleArrowDownInCodeBlock(event) {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

  const codeNode = EarlyEscapeCodeNode.$fromSelection(selection)
  if (!codeNode) return false

  if ($isCursorOnLastLine(selection) && !codeNode.getNextSibling()) {
    event?.preventDefault()
    const paragraph = $createParagraphNode()
    codeNode.insertAfter(paragraph)
    paragraph.selectEnd()
    return true
  }

  return false
}
