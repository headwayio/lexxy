import { $createParagraphNode, $getSelection, $isDecoratorNode, $isElementNode, $isRangeSelection, $splitNode, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_NORMAL, INSERT_PARAGRAPH_COMMAND, KEY_ARROW_DOWN_COMMAND, ParagraphNode, defineExtension } from "lexical"
import { CodeNode } from "@lexical/code"
import { ListItemNode } from "@lexical/list"
import { $isQuoteNode, QuoteNode } from "@lexical/rich-text"
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils"
import { EarlyEscapeCodeNode } from "../nodes/early_escape_code_node"
import { EarlyEscapeListItemNode } from "../nodes/early_escape_list_item_node"
import { $isBlankNode, $isCursorOnLastLine, $trimTrailingBlankNodes } from "../helpers/lexical_helper"
import LexxyExtension from "./lexxy_extension"

export class FormatEscapeExtension extends LexxyExtension {

  get enabled() {
    return this.editorElement.supportsRichText
  }

  get allowedElements() {
    return [ { tag: "li", attributes: [ "value" ] } ]
  }

  get lexicalExtension() {
    return defineExtension({
      name: "lexxy/format-escape",
      nodes: [
        EarlyEscapeCodeNode,
        { replace: CodeNode, with: (node) => new EarlyEscapeCodeNode(node.getLanguage()), withKlass: EarlyEscapeCodeNode },
        EarlyEscapeListItemNode,
        { replace: ListItemNode, with: () => new EarlyEscapeListItemNode(), withKlass: EarlyEscapeListItemNode },
      ],
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
          // Normalize QuoteNode children: Lexical's `> ` markdown shortcut and
          // some paste paths leave a QuoteNode with inline children (TextNodes,
          // LinkNodes, …) directly underneath, with no ParagraphNode wrapping
          // them. That breaks Enter behavior — Lexical's default tries to
          // split the blockquote itself and ends up creating a sibling
          // paragraph outside the quote, so the user gets ejected after one
          // keystroke. Wrapping any inline run in a ParagraphNode makes the
          // structure consistent with toolbar-created blockquotes and lets
          // Enter add a new paragraph inside the quote.
          editor.registerNodeTransform(QuoteNode, $wrapInlineQuoteChildren)
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

  // Don't exit when the cursor sits in the blockquote's ONLY paragraph and
  // it's empty — that's the freshly-inserted state, where the user expects
  // Enter to add a second line, not eject them out immediately. Falling
  // through to Lexical's default creates another paragraph below; the exit
  // happens on the next Enter (which sees a previous blank sibling).
  if (paragraph.getPreviousSibling() === null && paragraph.getNextSibling() === null) {
    return false
  }

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

// Wrap consecutive inline children of a QuoteNode in a ParagraphNode so
// blockquote contents are always block-level. Empty QuoteNodes get a single
// empty ParagraphNode so Enter has a paragraph to split. Idempotent: if every
// child is already a block-level element, this is a no-op.
function $wrapInlineQuoteChildren(quoteNode) {
  const children = quoteNode.getChildren()

  if (children.length === 0) {
    quoteNode.append($createParagraphNode())
    return
  }

  // Group consecutive inline siblings; flush each run into its own ParagraphNode.
  // Classification:
  //   - TextNode and other leaf nodes: inline (wrap in paragraph)
  //   - Inline ElementNodes (LinkNode, AutoLinkNode, MarkNode, …): inline
  //   - Block ElementNodes (ParagraphNode, HeadingNode, …): block separator
  //   - DecoratorNodes (attachments, images, HRs, embeds): block — leave
  //     as direct children of the QuoteNode. Wrapping them in a Paragraph
  //     fails Lexical reconciliation (error #14) because block-rendered
  //     decorator figures aren't valid paragraph children.
  let run = []
  const runs = []
  for (const child of children) {
    const isInline = $isDecoratorNode(child)
      ? false
      : ($isElementNode(child) ? child.isInline() : true)
    if (isInline) {
      run.push(child)
    } else {
      if (run.length > 0) { runs.push(run); run = [] }
    }
  }
  if (run.length > 0) runs.push(run)
  if (runs.length === 0) return

  for (const inlineRun of runs) {
    const paragraph = $createParagraphNode()
    inlineRun[0].insertBefore(paragraph)
    for (const node of inlineRun) {
      paragraph.append(node)
    }
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
