import { $createParagraphNode, $createTextNode, $getSelection, $isRangeSelection, $isTextNode, KEY_DOWN_COMMAND, COMMAND_PRIORITY_CRITICAL } from "lexical"
import { $createCodeNode, $isCodeNode } from "@lexical/code"
import { HorizontalDividerNode } from "../../nodes/horizontal_divider_node"

// Markdown export transformer for serialization
export const HORIZONTAL_RULE_TRANSFORMER = {
  dependencies: [HorizontalDividerNode],
  export: (node) => {
    if (node instanceof HorizontalDividerNode) {
      return "---"
    }
    return null
  },
  regExp: /^---$/,
  replace: (parentNode) => {
    const hr = new HorizontalDividerNode()
    parentNode.insertBefore(hr)
    parentNode.selectStart()
  },
  type: "element",
}

// Live typing shortcuts that trigger immediately (no trailing space required).
// Intercepts KEY_DOWN at CRITICAL priority to check if the keystroke would
// complete a "---" or "```" pattern, and transforms before Lexical processes it.
export function registerImmediateBlockShortcuts(editor) {
  return editor.registerCommand(
    KEY_DOWN_COMMAND,
    (event) => {
      // Only care about single printable characters
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return false

      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

      const anchorNode = selection.anchor.getNode()
      if (!$isTextNode(anchorNode)) return false

      const parent = anchorNode.getParent()
      if (!parent || $isCodeNode(parent)) return false
      if (anchorNode !== parent.getFirstChild()) return false

      const text = anchorNode.getTextContent()
      const offset = selection.anchor.offset

      // Check what the text would be after this keystroke
      const projected = text.slice(0, offset) + event.key + text.slice(offset)

      // --- → horizontal divider (only when it's the sole content and no siblings)
      if (projected === "---" && anchorNode.getNextSibling() === null) {
        event.preventDefault()

        const hr = new HorizontalDividerNode()
        const p = $createParagraphNode()
        parent.insertBefore(hr)
        parent.replace(p)
        p.selectStart()
        return true
      }

      // ``` → code block (text after cursor position becomes content)
      if (event.key === "`" && text.slice(0, offset) === "``" && offset === 2) {
        event.preventDefault()

        // Everything after the cursor is the content to put in the code block
        const afterBackticks = parent.getTextContent().slice(offset)

        const codeNode = $createCodeNode()
        if (afterBackticks.length > 0) {
          codeNode.append($createTextNode(afterBackticks))
        }
        parent.insertBefore(codeNode)
        parent.remove()
        codeNode.selectEnd()
        return true
      }

      return false
    },
    COMMAND_PRIORITY_CRITICAL
  )
}
