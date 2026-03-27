import { $createParagraphNode, $getSelection, $isParagraphNode, $isRangeSelection, $splitNode, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_NORMAL, INSERT_PARAGRAPH_COMMAND, KEY_ARROW_DOWN_COMMAND, ParagraphNode, TextNode, defineExtension } from "lexical"
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
    return defineExtension({
      name: "lexxy/format-escape",
      nodes: [
        EarlyEscapeCodeNode,
        { replace: CodeNode, with: (node) => new EarlyEscapeCodeNode(node.getLanguage()), withKlass: EarlyEscapeCodeNode },
        EarlyEscapeListItemNode,
        { replace: ListItemNode, with: (node) => {
          const replacement = new EarlyEscapeListItemNode(node.__value, node.__checked)
          if (node.__listItemType) replacement.setListItemType(node.__listItemType)
          return replacement
        }, withKlass: EarlyEscapeListItemNode },
      ],
      html: {
        import: {
          li: (element) => {
            if (!element.dataset?.listItemType) return null
            return {
              conversion: extendConversion(ListItemNode, "li", $applyListItemType),
              priority: 1
            }
          }
        }
      },
      register(editor) {
        return mergeRegister(
          editor.registerCommand(
            INSERT_PARAGRAPH_COMMAND,
            () => $escapeFromBlockquote(),
            COMMAND_PRIORITY_HIGH
          ),
          editor.registerCommand(
            KEY_ARROW_DOWN_COMMAND,
            (event) => $handleArrowDownInCodeBlock(event),
            COMMAND_PRIORITY_NORMAL
          ),
          editor.registerNodeTransform(TextNode, $toggleListItemTypeFromShortcut)
        )
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

const BULLET_TRIGGER = /^[-*+]\s/
const NUMBER_TRIGGER = /^\d{1,}\.\s/

function $toggleListItemTypeFromShortcut(textNode) {
  const parent = textNode.getParent()

  // Text can be a direct child of ListItemNode, or inside a ParagraphNode within one
  let listItem
  if ($isListItemNode(parent)) {
    listItem = parent
  } else if ($isParagraphNode(parent) && $isListItemNode(parent.getParent())) {
    listItem = parent.getParent()
  } else {
    return
  }

  if (!listItem.getEffectiveListType) return

  // Only trigger on the first text node at the start of the container
  if (parent.getFirstChild() !== textNode) return

  const text = textNode.getTextContent()
  const effectiveType = listItem.getEffectiveListType()

  if (effectiveType === "number" && BULLET_TRIGGER.test(text)) {
    listItem.setListItemType("bullet")
    textNode.setTextContent(text.replace(BULLET_TRIGGER, ""))
  } else if (effectiveType === "bullet" && NUMBER_TRIGGER.test(text)) {
    listItem.setListItemType("number")
    textNode.setTextContent(text.replace(NUMBER_TRIGGER, ""))
  }
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
