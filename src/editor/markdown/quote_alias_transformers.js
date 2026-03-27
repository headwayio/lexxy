import { $createQuoteNode, QuoteNode } from "@lexical/rich-text"

// | at the start of a line followed by a space → blockquote
export const QUOTE_PIPE_TRANSFORMER = {
  dependencies: [ QuoteNode ],
  export: null,
  regExp: /^\|\s/,
  replace: (parentNode, children, _match, isImport) => {
    const node = $createQuoteNode()
    node.append(...children)
    parentNode.replace(node)
    if (!isImport) {
      node.select(0, 0)
    }
  },
  type: "element",
}

// " at the start of a line followed by a space → blockquote
export const QUOTE_DOUBLEQUOTE_TRANSFORMER = {
  dependencies: [ QuoteNode ],
  export: null,
  regExp: /^["\u201C\u201D]\s/,
  replace: (parentNode, children, _match, isImport) => {
    const node = $createQuoteNode()
    node.append(...children)
    parentNode.replace(node)
    if (!isImport) {
      node.select(0, 0)
    }
  },
  type: "element",
}
