import LexxyExtension from "./lexxy_extension"
import { createElement } from "../helpers/html_helper"
import ToolbarIcons from "../elements/toolbar_icons"

const COLOR_NAMES = [ "Yellow", "Orange", "Red", "Pink", "Purple", "Blue", "Green", "Brown", "Gray" ]

function colorName(cssVar) {
  const match = cssVar.match(/--highlight-(?:bg-)?(\d+)/)
  return match ? COLOR_NAMES[parseInt(match[1]) - 1] || `Color ${match[1]}` : cssVar
}

const CONVERTIBLE_BLOCK_ITEMS = [
  { command: "setFormatParagraph", label: "Text", search: "paragraph normal text plain", icon: ToolbarIcons.paragraph },
  { command: "setFormatHeadingXLarge", label: "Heading 1", search: "heading 1 title h1 xlarge", icon: ToolbarIcons.h1, shortcut: "#" },
  { command: "setFormatHeadingLarge", label: "Heading 2", search: "heading 2 title h2 large", icon: ToolbarIcons.h2, shortcut: "##" },
  { command: "setFormatHeadingMedium", label: "Heading 3", search: "heading 3 title h3 medium", icon: ToolbarIcons.h3, shortcut: "###" },
  { command: "setFormatHeadingSmall", label: "Heading 4", search: "heading 4 title h4 small", icon: ToolbarIcons.h4, shortcut: "####" },
  { command: "insertUnorderedList", label: "Bullet list", search: "bullet list unordered", icon: ToolbarIcons.ul, shortcut: "-" },
  { command: "insertOrderedList", label: "Numbered list", search: "numbered list ordered", icon: ToolbarIcons.ol, shortcut: "1." },
  { command: "insertQuoteBlock", label: "Quote", search: "quote blockquote", icon: ToolbarIcons.quote, shortcut: "> | \"" },
  { command: "insertCodeBlock", label: "Code block", search: "code block pre", icon: ToolbarIcons.code, shortcut: "```" },
]

const INSERT_ONLY_ITEMS = [
  { command: "insertTable", label: "Table", search: "table grid", icon: ToolbarIcons.table },
  { command: "insertHorizontalDivider", label: "Divider", search: "divider horizontal rule line separator", icon: ToolbarIcons.hr, shortcut: "---" },
]

const SLASH_COMMAND_SECTIONS = [
  {
    section: "Basic blocks",
    items: [
      ...CONVERTIBLE_BLOCK_ITEMS.map(item => ({ ...item, insertBelow: true })),
      ...INSERT_ONLY_ITEMS,
    ]
  },
  {
    section: "Turn into",
    items: CONVERTIBLE_BLOCK_ITEMS.map(({ shortcut, ...item }) => ({ ...item, search: `${item.search} turn into`, filterSuffix: "Turn into" })),
  },
  {
    section: "Inline",
    items: [
      { command: "bold", label: "Bold", search: "bold strong", icon: ToolbarIcons.bold, shortcut: "**text**" },
      { command: "italic", label: "Italic", search: "italic emphasis", icon: ToolbarIcons.italic, shortcut: "_text_" },
      { command: "underline", label: "Underline", search: "underline", icon: ToolbarIcons.underline },
      { command: "strikethrough", label: "Strikethrough", search: "strikethrough strike", icon: ToolbarIcons.strikethrough, shortcut: "~~text~~" },
      { command: "link", label: "Link", search: "link url href", icon: ToolbarIcons.link },
    ]
  },
  {
    section: "Media",
    items: [
      { command: "uploadAttachments", label: "Upload file", search: "upload file attachment image media", icon: ToolbarIcons.attachment },
    ]
  },
]

export class SlashCommandsExtension extends LexxyExtension {
  get enabled() {
    return this.editorElement.supportsRichText
  }

  initializeEditor() {
    this.#buildPromptElement()
  }

  #buildPromptElement() {
    const prompt = createElement("lexxy-prompt")
    prompt.setAttribute("trigger", "/")
    prompt.setAttribute("dispatch-command", "")
    prompt.setAttribute("supports-space-in-searches", "")

    // Static command sections
    for (const { section, items } of SLASH_COMMAND_SECTIONS) {
      for (const { command, label, search, icon, shortcut, insertBelow, filterSuffix } of items) {
        prompt.appendChild(this.#buildCommandItem({ command, label, search, icon, section, shortcut, insertBelow, filterSuffix }))
      }
    }

    // Dynamic color sections from editor config
    const colorConfig = this.editorElement.config.get("highlight.buttons")
    if (colorConfig) {
      this.#appendColorItems(prompt, colorConfig)
    }

    this.editorElement.appendChild(prompt)
  }

  #buildCommandItem({ command, label, search, icon, section, payload, selectBlock, shortcut, insertBelow, filterSuffix }) {
    const item = createElement("lexxy-prompt-item")
    item.setAttribute("search", search)
    item.setAttribute("data-command", command)
    if (section) item.setAttribute("data-section", section)
    if (payload) item.setAttribute("data-command-payload", JSON.stringify(payload))
    if (selectBlock) item.setAttribute("data-command-select-block", "")
    if (insertBelow) item.setAttribute("data-insert-below", "")
    if (filterSuffix) item.setAttribute("data-filter-suffix", filterSuffix)

    const shortcutHtml = shortcut
      ? `<span class="lexxy-slash-command__shortcut">${shortcut}</span>`
      : ""

    const menuTemplate = document.createElement("template")
    menuTemplate.setAttribute("type", "menu")
    menuTemplate.innerHTML = `<span class="lexxy-slash-command__icon">${icon}</span><span class="lexxy-slash-command__label">${label}</span>${shortcutHtml}`

    item.appendChild(menuTemplate)
    return item
  }

  #buildColorItem({ label, search, section, style, value }) {
    const item = createElement("lexxy-prompt-item")
    item.setAttribute("search", search)
    item.setAttribute("data-command", "toggleHighlight")
    item.setAttribute("data-command-payload", JSON.stringify({ [style]: value }))
    item.setAttribute("data-command-select-block", "")
    item.setAttribute("data-section", section)

    const swatchHtml = style === "color"
      ? `<span class="lexxy-slash-command__color-swatch" style="color:${value}">A</span>`
      : `<span class="lexxy-slash-command__color-swatch" style="background-color:${value}"></span>`

    const menuTemplate = document.createElement("template")
    menuTemplate.setAttribute("type", "menu")
    menuTemplate.innerHTML = `${swatchHtml}<span class="lexxy-slash-command__label">${label}</span>`

    item.appendChild(menuTemplate)
    return item
  }

  #appendColorItems(prompt, colorConfig) {
    if (colorConfig.color?.length) {
      for (const value of colorConfig.color) {
        const name = colorName(value)
        prompt.appendChild(this.#buildColorItem({
          label: `${name} text`,
          search: `${name} text color`,
          section: "Text color",
          style: "color",
          value,
        }))
      }
    }

    if (colorConfig["background-color"]?.length) {
      for (const value of colorConfig["background-color"]) {
        const name = colorName(value)
        prompt.appendChild(this.#buildColorItem({
          label: `${name} background`,
          search: `${name} background color`,
          section: "Background color",
          style: "background-color",
          value,
        }))
      }
    }
  }
}
