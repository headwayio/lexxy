import { defineExtension } from "lexical"
import { CodeNode, normalizeCodeLang } from "@lexical/code"
import { extendConversion, extendTextNodeConversion } from "../helpers/lexical_helper"
import { $applyHighlightStyle } from "./highlight_extension"
import LexxyExtension from "./lexxy_extension"

const TRIX_LANGUAGE_ATTR = "language"

export class TrixContentExtension extends LexxyExtension {

  get enabled() {
    return this.editorElement.supportsRichText
  }

  get lexicalExtension() {
    return defineExtension({
      name: "lexxy/trix-content",
      html: {
        import: {
          em: (element) => onlyStyledElements(element, {
            conversion: extendTextNodeConversion("i", $applyHighlightStyle),
            priority: 1
          }),
          span: (element) => onlyStyledElements(element, {
            conversion: extendTextNodeConversion("mark", $applyHighlightStyle),
            priority: 1
          }),
          strong: (element) => onlyStyledElements(element, {
            conversion: extendTextNodeConversion("b", $applyHighlightStyle),
            priority: 1
          }),
          del: () => ({
            conversion: extendTextNodeConversion("s", $applyStrikethrough, $applyHighlightStyle),
            priority: 1
          }),
          pre: (element) => onlyPreLanguageElements(element, {
            conversion: extendConversion(CodeNode, "pre", $applyLanguage),
            priority: 1
          })
        }
      }
    })
  }
}

function onlyStyledElements(element, conversion) {
  const elementHighlighted = element.style.color !== "" || element.style.backgroundColor !== ""
  return elementHighlighted ? conversion : null
}

function $applyStrikethrough(textNode) {
  if (!textNode.hasFormat("strikethrough")) textNode.toggleFormat("strikethrough")
  return textNode
}

function onlyPreLanguageElements(element, conversion) {
  return detectLanguage(element) ? conversion : null
}

function detectLanguage(element) {
  // Trix format: <pre language="ruby">
  if (element.hasAttribute(TRIX_LANGUAGE_ATTR)) {
    return element.getAttribute(TRIX_LANGUAGE_ATTR)
  }

  // CommonMark / marked format: <pre><code class="language-ruby">
  const codeChild = element.querySelector("code[class*='language-']")
  if (codeChild) {
    const match = codeChild.className.match(/language-(\S+)/)
    if (match) return match[1]
  }

  return null
}

function $applyLanguage(conversionOutput, element) {
  const language = normalizeCodeLang(detectLanguage(element))
  conversionOutput.node.setLanguage(language)
}
