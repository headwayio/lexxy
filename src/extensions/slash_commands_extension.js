import LexxyExtension from "./lexxy_extension"
import { createElement } from "../helpers/html_helper"
import ToolbarIcons from "../elements/toolbar_icons"

const SLASH_COMMANDS = [
  { command: "setFormatParagraph", label: "Normal text", search: "paragraph normal text plain", icon: ToolbarIcons.paragraph },
  { command: "setFormatHeadingLarge", label: "Large Heading", search: "heading title h2 large", icon: ToolbarIcons.h2 },
  { command: "setFormatHeadingMedium", label: "Medium Heading", search: "heading title h3 medium", icon: ToolbarIcons.h3 },
  { command: "setFormatHeadingSmall", label: "Small Heading", search: "heading title h4 small", icon: ToolbarIcons.h4 },
  { command: "bold", label: "Bold", search: "bold strong", icon: ToolbarIcons.bold },
  { command: "italic", label: "Italic", search: "italic emphasis", icon: ToolbarIcons.italic },
  { command: "underline", label: "Underline", search: "underline", icon: ToolbarIcons.underline },
  { command: "strikethrough", label: "Strikethrough", search: "strikethrough strike", icon: ToolbarIcons.strikethrough },
  { command: "link", label: "Link", search: "link url href", icon: ToolbarIcons.link },
  { command: "insertUnorderedList", label: "Bullet list", search: "bullet list unordered", icon: ToolbarIcons.ul },
  { command: "insertOrderedList", label: "Numbered list", search: "numbered list ordered", icon: ToolbarIcons.ol },
  { command: "insertQuoteBlock", label: "Quote", search: "quote blockquote", icon: ToolbarIcons.quote },
  { command: "insertCodeBlock", label: "Code block", search: "code block pre", icon: ToolbarIcons.code },
  { command: "insertHorizontalDivider", label: "Divider", search: "divider horizontal rule line", icon: ToolbarIcons.hr },
  { command: "insertTable", label: "Table", search: "table grid", icon: ToolbarIcons.table },
  { command: "uploadAttachments", label: "Upload file", search: "upload file attachment image", icon: ToolbarIcons.attachment }
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

    for (const { command, label, search, icon } of SLASH_COMMANDS) {
      const item = createElement("lexxy-prompt-item")
      item.setAttribute("search", search)
      item.setAttribute("data-command", command)

      const menuTemplate = document.createElement("template")
      menuTemplate.setAttribute("type", "menu")
      menuTemplate.innerHTML = `<span class="lexxy-slash-command__icon">${icon}</span><span class="lexxy-slash-command__label">${label}</span>`

      item.appendChild(menuTemplate)
      prompt.appendChild(item)
    }

    this.editorElement.appendChild(prompt)
  }
}
