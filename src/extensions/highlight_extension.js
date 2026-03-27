import { $getNodeByKey, $getState, $hasUpdateTag, $isTextNode, $setState, COMMAND_PRIORITY_CRITICAL, COMMAND_PRIORITY_LOW, COMMAND_PRIORITY_NORMAL, KEY_ENTER_COMMAND, PASTE_TAG, TextNode, createCommand, createState, defineExtension } from "lexical"
import { $getSelection, $isRangeSelection } from "lexical"
import { $getSelectionStyleValueForProperty, $patchStyleText, getCSSFromStyleObject, getStyleObjectFromCSS } from "@lexical/selection"
import { $createCodeHighlightNode, $createCodeNode, $isCodeHighlightNode, $isCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code"
import { $isListItemNode, $isListNode, ListItemNode } from "@lexical/list"
import { extendTextNodeConversion } from "../helpers/lexical_helper"
import { StyleCanonicalizer, applyCanonicalizers, hasHighlightStyles } from "../helpers/format_helper"
import { RichTextExtension } from "@lexical/rich-text"
import LexxyExtension from "./lexxy_extension"
import { mergeRegister } from "@lexical/utils"

export const TOGGLE_HIGHLIGHT_COMMAND = createCommand()
export const REMOVE_HIGHLIGHT_COMMAND = createCommand()
export const BLANK_STYLES = { "color": null, "background-color": null }

const hasPastedStylesState = createState("hasPastedStyles", {
  parse: (value) => value || false
})

// Stores pending highlight ranges extracted during HTML import, keyed by CodeNode key.
// After the code retokenizer creates fresh CodeHighlightNodes, a mutation listener
// reads this map and re-applies the highlight styles. Scoped per editor instance
// so entries don't leak across editors or outlive a torn-down editor.
const pendingCodeHighlights = new WeakMap()

export class HighlightExtension extends LexxyExtension {
  get enabled() {
    return this.editorElement.supportsRichText
  }

  get lexicalExtension() {
    const extension = defineExtension({
      dependencies: [ RichTextExtension ],
      name: "lexxy/highlight",
      config: {
        color: { buttons: [], permit: [] },
        "background-color": { buttons: [], permit: [] }
      },
      html: {
        import: {
          mark: $markConversion
        }
      },
      register(editor, config) {
        // keep the ref to the canonicalizers for optimized css conversion
        const canonicalizers = buildCanonicalizers(config)

        // Register the <pre> converter directly in the conversion cache so it
        // coexists with other extensions' "pre" converters (the extension-level
        // html.import uses Object.assign, which means only one "pre" per key).
        $registerPreConversion(editor)

        return mergeRegister(
          editor.registerCommand(TOGGLE_HIGHLIGHT_COMMAND, (styles) => $toggleSelectionStyles(editor, styles), COMMAND_PRIORITY_NORMAL),
          editor.registerCommand(REMOVE_HIGHLIGHT_COMMAND, () => $toggleSelectionStyles(editor, BLANK_STYLES), COMMAND_PRIORITY_NORMAL),
          editor.registerNodeTransform(TextNode, $syncHighlightWithStyle),
          editor.registerNodeTransform(CodeHighlightNode, $syncHighlightWithCodeHighlightNode),
          editor.registerNodeTransform(TextNode, (textNode) => $canonicalizePastedStyles(textNode, canonicalizers)),
          editor.registerMutationListener(CodeNode, (mutations) => {
            $applyPendingCodeHighlights(editor, mutations)
          }, { skipInitialization: true }),
          $registerMarkPaddingSync(editor),
          $registerHighlightClearOnEnter(editor),
          $registerHighlightPropagation(editor),
          $registerBulletMarkerColorSync(editor)
        )
      }
    })

    return [ extension, this.editorConfig.get("highlight") ]
  }
}

export function $applyHighlightStyle(textNode, element) {
  const elementStyles = {
    color: element.style?.color,
    "background-color": element.style?.backgroundColor
  }

  if ($hasUpdateTag(PASTE_TAG)) { $setPastedStyles(textNode) }
  const highlightStyle = getCSSFromStyleObject(elementStyles)

  if (highlightStyle.length) {
    return textNode.setStyle(textNode.getStyle() + highlightStyle)
  }
}

function $markConversion() {
  return {
    conversion: extendTextNodeConversion("mark", $applyHighlightStyle),
    priority: 1
  }
}

// Register a custom <pre> converter directly in the editor's HTML conversion
// cache. We can't use the extension-level html.import because Object.assign
// merges all extensions' converters by tag, and a later extension (e.g.
// TrixContentExtension) would overwrite ours.
function $registerPreConversion(editor) {
  if (!editor._htmlConversions) return

  let preEntries = editor._htmlConversions.get("pre")
  if (!preEntries) {
    preEntries = []
    editor._htmlConversions.set("pre", preEntries)
  }
  preEntries.push($preConversionWithHighlightsFactory(editor))
}

// Returns a <pre> converter factory scoped to a specific editor instance.
// The factory extracts highlight ranges from <mark> elements before the code
// retokenizer can destroy them. The ranges are stored in pendingCodeHighlights
// and applied after retokenization via a mutation listener.
function $preConversionWithHighlightsFactory(editor) {
  return function $preConversionWithHighlights(domNode) {
    const highlights = extractHighlightRanges(domNode)
    if (highlights.length === 0) return null

    return {
      conversion: (domNode) => {
        const language = domNode.getAttribute("data-language")
        const codeNode = $createCodeNode(language)
        $getPendingHighlights(editor).set(codeNode.getKey(), highlights)
        return { node: codeNode }
      },
      priority: 2
    }
  }
}

// Walk the DOM tree inside a <pre> element and build a list of
// { start, end, style } ranges for every <mark> element found.
function extractHighlightRanges(preElement) {
  const ranges = []
  const codeElement = preElement.querySelector("code") || preElement

  let offset = 0

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent.length
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // <br> maps to a LineBreakNode (1 character) in Lexical
      if (node.tagName === "BR") {
        offset += 1
        return
      }

      const isMark = node.tagName === "MARK"
      const start = offset

      for (const child of node.childNodes) {
        walk(child)
      }

      if (isMark) {
        const style = extractHighlightStyleFromElement(node)
        if (style) {
          ranges.push({ start, end: offset, style })
        }
      }
    }
  }

  for (const child of codeElement.childNodes) {
    walk(child)
  }

  return ranges
}

function $getPendingHighlights(editor) {
  let map = pendingCodeHighlights.get(editor)
  if (!map) {
    map = new Map()
    pendingCodeHighlights.set(editor, map)
  }
  return map
}

function extractHighlightStyleFromElement(element) {
  const styles = {}
  if (element.style?.color) styles.color = element.style.color
  if (element.style?.backgroundColor) styles["background-color"] = element.style.backgroundColor
  const css = getCSSFromStyleObject(styles)
  return css.length > 0 ? css : null
}

// Called from the CodeNode mutation listener after the retokenizer has
// replaced TextNodes with fresh CodeHighlightNodes.
function $applyPendingCodeHighlights(editor, mutations) {
  const pending = $getPendingHighlights(editor)
  const keysToProcess = []

  for (const [ key, type ] of mutations) {
    if (type !== "destroyed" && pending.has(key)) {
      keysToProcess.push(key)
    }
  }

  if (keysToProcess.length === 0) return

  // Use a deferred update so the retokenizer has finished its
  // skipTransforms update before we touch the nodes.
  editor.update(() => {
    for (const key of keysToProcess) {
      const highlights = pending.get(key)
      pending.delete(key)
      if (!highlights) continue

      const codeNode = $getNodeByKey(key)
      if (!codeNode || !$isCodeNode(codeNode)) continue

      $applyHighlightRangesToCodeNode(codeNode, highlights)
    }
  }, { skipTransforms: true, discrete: true })
}

// Apply saved highlight ranges to the CodeHighlightNode children
// of a CodeNode, splitting nodes at range boundaries as needed.
// We can't use TextNode.splitText() because it creates TextNode
// instances (not CodeHighlightNodes) for the split parts. Instead,
// we manually create CodeHighlightNode replacements.
function $applyHighlightRangesToCodeNode(codeNode, highlights) {
  if (highlights.length === 0) return

  for (const { start: hlStart, end: hlEnd, style } of highlights) {
    // Rebuild the child-to-offset mapping for each highlight range because
    // earlier ranges may have split nodes, invalidating previous mappings.
    const childRanges = $buildChildRanges(codeNode)

    for (const { node, start: nodeStart, end: nodeEnd } of childRanges) {
      // Check if this child overlaps with the highlight range
      const overlapStart = Math.max(hlStart, nodeStart)
      const overlapEnd = Math.min(hlEnd, nodeEnd)

      if (overlapStart >= overlapEnd) continue

      // Calculate offsets relative to this node
      const relStart = overlapStart - nodeStart
      const relEnd = overlapEnd - nodeStart
      const nodeLength = nodeEnd - nodeStart

      if (relStart === 0 && relEnd === nodeLength) {
        // Entire node is highlighted - apply style directly
        node.setStyle(style)
        $setCodeHighlightFormat(node, true)
      } else {
        // Need to split: replace the node with 2 or 3 CodeHighlightNodes
        const text = node.getTextContent()
        const highlightType = node.getHighlightType()
        const replacements = []

        if (relStart > 0) {
          replacements.push($createCodeHighlightNode(text.slice(0, relStart), highlightType))
        }

        const styledNode = $createCodeHighlightNode(text.slice(relStart, relEnd), highlightType)
        styledNode.setStyle(style)
        $setCodeHighlightFormat(styledNode, true)
        replacements.push(styledNode)

        if (relEnd < nodeLength) {
          replacements.push($createCodeHighlightNode(text.slice(relEnd), highlightType))
        }

        for (const replacement of replacements) {
          node.insertBefore(replacement)
        }
        node.remove()
      }
    }
  }
}

function $buildChildRanges(codeNode) {
  const childRanges = []
  let charOffset = 0

  for (const child of codeNode.getChildren()) {
    if ($isCodeHighlightNode(child)) {
      const text = child.getTextContent()
      childRanges.push({ node: child, start: charOffset, end: charOffset + text.length })
      charOffset += text.length
    } else {
      // LineBreakNode, TabNode - count as 1 character each (\n, \t)
      charOffset += 1
    }
  }

  return childRanges
}

function buildCanonicalizers(config) {
  return [
    new StyleCanonicalizer("color", [ ...config.buttons.color, ...config.permit.color ]),
    new StyleCanonicalizer("background-color", [ ...config.buttons["background-color"], ...config.permit["background-color"] ])
  ]
}

function $toggleSelectionStyles(editor, styles) {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return

  const patch = {}
  for (const property in styles) {
    const oldValue = $getSelectionStyleValueForProperty(selection, property)
    patch[property] = toggleOrReplace(oldValue, styles[property])
  }

  if ($selectionIsInCodeBlock(selection)) {
    $patchCodeHighlightStyles(editor, selection, patch)
  } else {
    $patchStyleText(selection, patch)
  }
}

function $selectionIsInCodeBlock(selection) {
  const nodes = selection.getNodes()
  return nodes.some((node) => {
    const parent = $isCodeHighlightNode(node) ? node.getParent() : node
    return $isCodeNode(parent)
  })
}

function $patchCodeHighlightStyles(editor, selection, patch) {
  // Capture selection state and node keys before the nested update
  const nodeKeys = selection.getNodes()
    .filter((node) => $isCodeHighlightNode(node))
    .map((node) => ({
      key: node.getKey(),
      startOffset: $getNodeSelectionOffsets(node, selection)[0],
      endOffset: $getNodeSelectionOffsets(node, selection)[1],
      textSize: node.getTextContentSize()
    }))

  // Use skipTransforms to prevent the code highlighting system from
  // re-tokenizing and wiping out the style changes we apply.
  // Use discrete to force a synchronous commit, ensuring the changes
  // are committed before editor.focus() triggers a second update cycle
  // that would re-run transforms and wipe out the styles.
  editor.update(() => {
    for (const { key, startOffset, endOffset, textSize } of nodeKeys) {
      const node = $getNodeByKey(key)
      if (!node || !$isCodeHighlightNode(node)) continue

      const parent = node.getParent()
      if (!$isCodeNode(parent)) continue
      if (startOffset === endOffset) continue

      if (startOffset === 0 && endOffset === textSize) {
        $applyStylePatchToNode(node, patch)
      } else {
        const splitNodes = node.splitText(startOffset, endOffset)
        const targetNode = splitNodes[startOffset === 0 ? 0 : 1]
        $applyStylePatchToNode(targetNode, patch)
      }
    }
  }, { skipTransforms: true, discrete: true })
}

function $getNodeSelectionOffsets(node, selection) {
  const nodeKey = node.getKey()
  const anchorKey = selection.anchor.key
  const focusKey = selection.focus.key
  const textSize = node.getTextContentSize()

  const isAnchor = nodeKey === anchorKey
  const isFocus = nodeKey === focusKey

  // Determine if selection is forward or backward
  const isForward = selection.isBackward() === false

  let start = 0
  let end = textSize

  if (isForward) {
    if (isAnchor) start = selection.anchor.offset
    if (isFocus) end = selection.focus.offset
  } else {
    if (isFocus) start = selection.focus.offset
    if (isAnchor) end = selection.anchor.offset
  }

  return [ start, end ]
}

function $applyStylePatchToNode(node, patch) {
  const prevStyles = getStyleObjectFromCSS(node.getStyle())
  const newStyles = { ...prevStyles }

  for (const [ key, value ] of Object.entries(patch)) {
    if (value === null) {
      delete newStyles[key]
    } else {
      newStyles[key] = value
    }
  }

  const newCSSText = getCSSFromStyleObject(newStyles)
  node.setStyle(newCSSText)

  // Sync the highlight format using TextNode's setFormat to bypass
  // CodeHighlightNode's no-op override
  const shouldHaveHighlight = hasHighlightStyles(newCSSText)
  const hasHighlight = node.hasFormat("highlight")

  if (shouldHaveHighlight !== hasHighlight) {
    $setCodeHighlightFormat(node, shouldHaveHighlight)
  }
}

function $setCodeHighlightFormat(node, shouldHaveHighlight) {
  const writable = node.getWritable()
  const IS_HIGHLIGHT = 1 << 7

  if (shouldHaveHighlight) {
    writable.__format |= IS_HIGHLIGHT
  } else {
    writable.__format &= ~IS_HIGHLIGHT
  }
}

function toggleOrReplace(oldValue, newValue) {
  return oldValue === newValue ? null : newValue
}

function $syncHighlightWithStyle(textNode) {
  if (hasHighlightStyles(textNode.getStyle()) !== textNode.hasFormat("highlight")) {
    textNode.toggleFormat("highlight")
  }
}

function $syncHighlightWithCodeHighlightNode(node) {
  const parent = node.getParent()
  if (!$isCodeNode(parent)) return

  const shouldHaveHighlight = hasHighlightStyles(node.getStyle())
  const hasHighlight = node.hasFormat("highlight")

  if (shouldHaveHighlight !== hasHighlight) {
    $setCodeHighlightFormat(node, shouldHaveHighlight)
  }
}

function $canonicalizePastedStyles(textNode, canonicalizers = []) {
  if ($hasPastedStyles(textNode)) {
    $setPastedStyles(textNode, false)

    const canonicalizedCSS = applyCanonicalizers(textNode.getStyle(), canonicalizers)
    textNode.setStyle(canonicalizedCSS)

    const selection = $getSelection()
    if (textNode.isSelected(selection)) {
      selection.setStyle(textNode.getStyle())
      selection.setFormat(textNode.getFormat())
    }
  }
}

function $setPastedStyles(textNode, value = true) {
  $setState(textNode, hasPastedStylesState, value)
}

function $hasPastedStyles(textNode) {
  return $getState(textNode, hasPastedStylesState)
}

// After DOM reconciliation, scan <mark> elements and set data-pad-start /
// data-pad-end attributes based on whether the mark sits at a word boundary.
// Marks mid-word get no horizontal padding; marks at word edges get padding.
function $registerMarkPaddingSync(editor) {
  return editor.registerUpdateListener(() => {
    requestAnimationFrame(() => {
      const root = editor.getRootElement()
      if (!root) return

      for (const mark of root.querySelectorAll("mark")) {
        const prev = mark.previousSibling
        const next = mark.nextSibling

        const padStart = !prev || (prev.textContent && /\s$/.test(prev.textContent))
        const padEnd = !next || (next.textContent && /^\s/.test(next.textContent))

        mark.toggleAttribute("data-pad-start", padStart)
        mark.toggleAttribute("data-pad-end", padEnd)
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Highlight inheritance for lists
// ---------------------------------------------------------------------------

// CSS parsing helpers — use manual regex instead of getStyleObjectFromCSS
// because getStyleObjectFromCSS fails on CSS var() values in Rollup production.

export function $extractHighlightFromCSS(css) {
  if (!css) return null
  const result = {}
  const colorMatch = css.match(/(?:^|;\s*)color\s*:\s*([^;]+)/)
  const bgMatch = css.match(/(?:^|;\s*)background-color\s*:\s*([^;]+)/)
  if (colorMatch) result.color = colorMatch[1].trim()
  if (bgMatch) result["background-color"] = bgMatch[1].trim()
  return (result.color || result["background-color"]) ? result : null
}

export function $mergeHighlightIntoCSS(existingCSS, highlight) {
  const parts = (existingCSS || "").split(";").filter(s => s.trim())
  const nonHighlight = parts.filter(p => {
    const key = p.split(":")[0]?.trim()
    return key !== "color" && key !== "background-color"
  })
  if (highlight.color) nonHighlight.push(`color: ${highlight.color}`)
  if (highlight["background-color"]) nonHighlight.push(`background-color: ${highlight["background-color"]}`)
  return nonHighlight.join(";") + ";"
}

export function $removeHighlightFromCSS(css) {
  if (!css) return null
  const parts = css.split(";").filter(s => s.trim())
  const kept = parts.filter(p => {
    const key = p.split(":")[0]?.trim()
    return key !== "color" && key !== "background-color"
  })
  return kept.length > 0 ? kept.join(";") + ";" : null
}

// List structure helpers

export function $isStructuralWrapper(listItemNode) {
  const children = listItemNode.getChildren()
  return children.length > 0 && children.every(c => $isListNode(c))
}

export function $getOwnStructuralWrapper(node) {
  const next = node.getNextSibling()
  if (next && $isListItemNode(next) && $isStructuralWrapper(next)) return next
  return null
}

// Tree traversal — collect text nodes, skipping code blocks

export function $collectTextNodes(node, result) {
  if ($isCodeNode(node)) return
  if ($isTextNode(node)) result.push(node)
  else if (node.getChildren) node.getChildren().forEach(c => $collectTextNodes(c, result))
}

export function $collectAllDescendantTextNodes(node, result) {
  if ($isCodeNode(node)) return
  if ($isTextNode(node)) { result.push(node); return }
  if (node.getChildren) {
    for (const child of node.getChildren()) {
      $collectAllDescendantTextNodes(child, result)
    }
  }
}

// Highlight comparison helpers

export function $highlightColorsMatch(style1, style2) {
  const h1 = $extractHighlightFromCSS(style1)
  const h2 = $extractHighlightFromCSS(style2)
  if (!h1 && !h2) return true
  if (!h1 || !h2) return false
  return (h1.color || "") === (h2.color || "") &&
    (h1["background-color"] || "") === (h2["background-color"] || "")
}

export function $getImmediateParentHighlight(listItem) {
  if (!$isListItemNode(listItem)) return null
  const parentList = listItem.getParent()
  if (!$isListNode(parentList)) return null
  const wrapper = parentList.getParent()
  if (!$isListItemNode(wrapper)) return null
  const textItem = wrapper.getPreviousSibling()
  if (!textItem || !$isListItemNode(textItem)) return null

  const textNodes = []
  textItem.getChildren().forEach(c => { if (!$isListNode(c)) $collectTextNodes(c, textNodes) })
  if (textNodes.length === 0) return null

  const firstHighlight = $extractHighlightFromCSS(textNodes[0].getStyle())
  if (!firstHighlight) return null

  const allMatch = textNodes.every(t => {
    const h = $extractHighlightFromCSS(t.getStyle())
    return h &&
      (h.color || "") === (firstHighlight.color || "") &&
      (h["background-color"] || "") === (firstHighlight["background-color"] || "")
  })

  return allMatch ? firstHighlight : null
}

export function $shouldRetainHighlightFromParent(node, currentStyle) {
  const parentHighlight = $getImmediateParentHighlight(node)
  if (!parentHighlight) return false
  return $highlightColorsMatch(currentStyle, $mergeHighlightIntoCSS("", parentHighlight))
}

// Apply parent list item's highlight color to a child node on indent
export function $inheritParentHighlight(node) {
  const parent = node.getParent()
  if (!$isListNode(parent)) return

  const wrapper = parent.getParent()
  if (!$isListItemNode(wrapper)) return
  const textItem = wrapper.getPreviousSibling()
  if (!textItem || !$isListItemNode(textItem)) return

  const textNodes = []
  textItem.getChildren().forEach(c => { if (!$isListNode(c)) $collectTextNodes(c, textNodes) })
  if (textNodes.length === 0) return

  const rawStyle = textNodes[0].getStyle()
  const firstHighlight = $extractHighlightFromCSS(rawStyle)
  if (!firstHighlight) return

  const allMatch = textNodes.every(t => {
    const h = $extractHighlightFromCSS(t.getStyle())
    return h &&
      (h.color || "") === (firstHighlight.color || "") &&
      (h["background-color"] || "") === (firstHighlight["background-color"] || "")
  })
  if (!allMatch) return

  const childTextNodes = []
  $collectTextNodes(node, childTextNodes)
  const ownWrapper = $getOwnStructuralWrapper(node)
  if (ownWrapper) $collectAllDescendantTextNodes(ownWrapper, childTextNodes)

  for (const textNode of childTextNodes) {
    const newStyle = $mergeHighlightIntoCSS(textNode.getStyle(), firstHighlight)
    textNode.setStyle(newStyle)
  }

  if ($isListItemNode(node)) {
    node.setTextStyle($mergeHighlightIntoCSS(node.getTextStyle(), firstHighlight))
  }
  const selection = $getSelection()
  if ($isRangeSelection(selection)) {
    selection.setStyle($mergeHighlightIntoCSS(selection.style, firstHighlight))
  }
}

// Clear highlight on Enter: when creating a new empty block, remove inherited
// color/background-color unless the parent list item is uniformly highlighted.
function $registerHighlightClearOnEnter(editor) {
  return editor.registerCommand(KEY_ENTER_COMMAND, () => {
    $clearHighlightOnNewBlock(editor)
    return false // don't consume — let Lexical create the new block
  }, COMMAND_PRIORITY_LOW)
}

function $clearHighlightOnNewBlock(editor) {
  editor.update(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    let anchor = selection.anchor.getNode()

    if (!$isTextNode(anchor)) {
      const firstChild = anchor.getFirstChild?.()
      if ($isTextNode(firstChild)) {
        anchor = firstChild
      } else {
        const selStyle = selection.style
        if (selStyle && hasHighlightStyles(selStyle)) {
          if (!$shouldRetainHighlightForAnchor(anchor, selStyle)) {
            const styles = getStyleObjectFromCSS(selStyle)
            delete styles.color
            delete styles["background-color"]
            selection.setStyle(getCSSFromStyleObject(styles))
          }
        }
        return
      }
    }

    // eslint-disable-next-line no-misleading-character-class
    const text = anchor.getTextContent().replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    if (text.length > 0) return

    const style = anchor.getStyle()
    if (!hasHighlightStyles(style)) return

    if ($shouldRetainHighlightForAnchor(anchor, style)) return

    const styles = getStyleObjectFromCSS(style)
    delete styles.color
    delete styles["background-color"]
    const newCSS = getCSSFromStyleObject(styles)
    anchor.setStyle(newCSS)
    selection.setStyle(newCSS)
  })
}

function $shouldRetainHighlightForAnchor(anchor, style) {
  let listItem = anchor
  while (listItem && !$isListItemNode(listItem)) {
    listItem = listItem.getParent()
  }
  return listItem ? $shouldRetainHighlightFromParent(listItem, style) : false
}

// When a highlight color is applied to a parent list item, propagate it to
// all children in the structural wrapper so the whole subtree matches.
function $registerHighlightPropagation(editor) {
  return editor.registerCommand(TOGGLE_HIGHLIGHT_COMMAND, (styles) => {
    setTimeout(() => $propagateHighlightToChildren(editor, styles), 0)
    return false // don't consume — let the highlight extension handle it
  }, COMMAND_PRIORITY_CRITICAL)
}

function $propagateHighlightToChildren(editor, _styles) {
  editor.update(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    let listItem = null
    let current = selection.anchor.getNode()
    while (current) {
      if ($isListItemNode(current)) { listItem = current; break }
      current = current.getParent()
    }
    if (!listItem) return

    const wrapper = $getOwnStructuralWrapper(listItem)
    if (!wrapper) return

    const parentTextNodes = []
    listItem.getChildren().forEach(c => {
      if (!$isListNode(c)) $collectTextNodes(c, parentTextNodes)
    })
    if (parentTextNodes.length === 0) return

    const parentStyle = parentTextNodes[0].getStyle()
    if (!parentTextNodes.every(t => t.getStyle() === parentStyle)) return

    const childTextNodes = []
    $collectAllDescendantTextNodes(wrapper, childTextNodes)
    const parentStyles = getStyleObjectFromCSS(parentStyle)

    for (const textNode of childTextNodes) {
      const existing = getStyleObjectFromCSS(textNode.getStyle() || "")
      if (parentStyles.color) existing.color = parentStyles.color
      else delete existing.color
      if (parentStyles["background-color"]) existing["background-color"] = parentStyles["background-color"]
      else delete existing["background-color"]
      textNode.setStyle(getCSSFromStyleObject(existing))
    }
  })
}

// Sync the <li> element's color from its text content so that bullet markers
// (which use currentColor via ::before) match the text color.
function $registerBulletMarkerColorSync(editor) {
  return editor.registerNodeTransform(ListItemNode, (node) => {
    if ($isStructuralWrapper(node)) return

    const textNodes = []
    node.getChildren().forEach(c => {
      if (!$isListNode(c)) $collectTextNodes(c, textNodes)
    })

    const highlight = textNodes.length > 0
      ? $extractHighlightFromCSS(textNodes[0].getStyle())
      : null

    const liHighlight = $extractHighlightFromCSS(node.getStyle())

    const effectiveHighlight = highlight
      || $extractHighlightFromCSS(node.getTextStyle())

    if (effectiveHighlight?.color) {
      const allSameColor = !highlight || textNodes.every(t => {
        const h = $extractHighlightFromCSS(t.getStyle())
        return h && (h.color || "") === (effectiveHighlight.color || "")
      })
      if (allSameColor && (liHighlight?.color || "") !== effectiveHighlight.color) {
        node.setStyle($mergeHighlightIntoCSS(node.getStyle(), { color: effectiveHighlight.color }))
      }
    } else if (liHighlight?.color) {
      node.setStyle($removeHighlightFromCSS(node.getStyle()) ?? "")
    }
  })
}
