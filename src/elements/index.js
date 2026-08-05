import Lexxy from "../config/lexxy"
import Toolbar from "./toolbar"
import ToolbarDropdown from "./toolbar_dropdown"
import HeadingDropdown from "./dropdown/heading"
import HighlightDropdown from "./dropdown/highlight"
import LinkDropdown from "./dropdown/link"
import Editor from "./editor"
import BlockActionsMenu from "./block_actions_menu"
import Prompt from "./prompt"
import CodeLanguagePicker from "./code_language_picker"
import AttachmentControls from "./attachment_controls"
import PreviewModal from "./preview_modal"
import TableTools from "./table/table_tools"

export function defineElements() {
  const elements = {
    // Toolbar must be registered BEFORE Editor
    "lexxy-toolbar": Toolbar,
    "lexxy-toolbar-dropdown": ToolbarDropdown,
    "lexxy-heading-dropdown": HeadingDropdown,
    "lexxy-highlight-dropdown": HighlightDropdown,
    "lexxy-link-dropdown": LinkDropdown,

    "lexxy-editor": Editor,
    "lexxy-block-actions": BlockActionsMenu,

    // Prompt must be registered AFTER Editor
    "lexxy-prompt": Prompt,
    "lexxy-code-language-picker": CodeLanguagePicker,
    "lexxy-attachment-controls": AttachmentControls,
    "lexxy-table-tools": TableTools
  }

  if (Lexxy.global.get("previewModal")) {
    elements["lexxy-preview-modal"] = PreviewModal
  }

  Object.entries(elements).forEach(([ name, element ]) => {
    customElements.define(name, element)
  })

  if (Lexxy.global.get("previewModal")) {
    if (document.body) {
      document.body.appendChild(document.createElement("lexxy-preview-modal"))
    } else {
      // Script was loaded in <head> without defer/module; defer body append
      // until the body parses, otherwise document.body is null and throws.
      document.addEventListener("DOMContentLoaded", () => {
        document.body.appendChild(document.createElement("lexxy-preview-modal"))
      }, { once: true })
    }
  }
}
