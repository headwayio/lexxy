import { $getNodeByKey, $getSelection, $isElementNode, $isRangeSelection, $isParagraphNode, $isTextNode } from "lexical"
import { $isListItemNode, $isListNode } from "@lexical/list"
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text"

// Mapping of leading patterns to block creators
const BLOCK_PATTERNS = [
  { regex: /^####\s$/, create: () => $createHeadingNode("h4") },
  { regex: /^###\s$/, create: () => $createHeadingNode("h3") },
  { regex: /^##\s$/, create: () => $createHeadingNode("h2") },
  { regex: /^#\s$/, create: () => $createHeadingNode("h1") },
  { regex: /^>\s$/, create: () => $createQuoteNode() }
]

// Registers a listener that converts `# ` (and ##, ###, ####) and `> ` at the
// start of a list item into a wrapped block. Lexical's built-in markdown
// shortcuts only work on paragraphs — this extends them to list items.
export function registerListBlockShortcuts(editor) {
  return editor.registerUpdateListener(({ tags, dirtyLeaves, editorState, prevEditorState }) => {
    if (tags.has("historic") || tags.has("collaboration")) return
    if (editor.isComposing()) return

    const selection = editorState.read($getSelection)
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

    const anchorKey = selection.anchor.key
    const anchorOffset = selection.anchor.offset

    if (!dirtyLeaves.has(anchorKey)) return

    editorState.read(() => {
      const anchorNode = $getNodeByKey(anchorKey)
      if (!$isTextNode(anchorNode)) return

      // Only trigger inside list items
      const listItem = findParentListItem(anchorNode)
      if (!listItem) return

      // Must be the first text node in the list item (not inside a wrapped block)
      const parent = anchorNode.getParent()
      if (parent && !$isListItemNode(parent) && !$isParagraphNode(parent)) return

      const textContent = anchorNode.getTextContent()

      for (const { regex, create } of BLOCK_PATTERNS) {
        if (regex.test(textContent.slice(0, anchorOffset))) {
          editor.update(() => {
            const freshNode = $getNodeByKey(anchorKey)
            if (!freshNode) return
            const freshListItem = findParentListItem(freshNode)
            if (!freshListItem) return

            const content = freshNode.getTextContent()
            const match = content.match(/^(?:#{1,4}|>)\s/)
            if (!match) return

            const block = create()
            const remaining = content.slice(match[0].length)

            const children = freshListItem.getChildren()
            const existingWrapped = children.find(c =>
              $isElementNode(c) && !$isListNode(c) && !$isParagraphNode(c)
            )

            if (existingWrapped) {
              for (const child of [ ...existingWrapped.getChildren() ]) {
                block.append(child)
              }
              existingWrapped.replace(block)
            } else {
              for (const child of [ ...children ]) {
                if ($isListNode(child)) continue
                block.append(child)
              }
              const firstChild = freshListItem.getFirstChild()
              if (firstChild) {
                firstChild.insertBefore(block)
              } else {
                freshListItem.append(block)
              }
            }

            const textNode = block.getFirstChild()
            if ($isTextNode(textNode)) {
              textNode.setTextContent(remaining)
            }
            block.selectEnd()
          })
          return
        }
      }
    })
  })
}

function findParentListItem(node) {
  let current = node
  while (current) {
    if ($isListItemNode(current)) return current
    current = current.getParent()
  }
  return null
}
