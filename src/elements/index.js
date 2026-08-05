import Lexxy from "../config/lexxy"
import Toolbar from "./toolbar"

import Editor from "./editor"
import BlockActionsMenu from "./block_actions_menu"
import DropdownLink from "./dropdown/link"
import DropdownHighlight from "./dropdown/highlight"
import Prompt from "./prompt"
import CodeLanguagePicker from "./code_language_picker"
import AttachmentControls from "./attachment_controls"
import PreviewModal from "./preview_modal"
import TableTools from "./table/table_tools"

export function defineElements() {
  const elements = {
    "lexxy-toolbar": Toolbar,
    "lexxy-editor": Editor,
    "lexxy-block-actions": BlockActionsMenu,
    "lexxy-link-dropdown": DropdownLink,
    "lexxy-highlight-dropdown": DropdownHighlight,
    "lexxy-prompt": Prompt,
    "lexxy-code-language-picker": CodeLanguagePicker,
    "lexxy-attachment-controls": AttachmentControls,
    "lexxy-table-tools": TableTools,
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
