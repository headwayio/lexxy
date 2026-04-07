import { $isCodeNode, CODE_LANGUAGE_FRIENDLY_NAME_MAP, normalizeCodeLang } from "@lexical/code"
import { $getSelection, $isRangeSelection } from "lexical"
import { createElement, dispatch } from "../helpers/html_helper"
import { getNonce } from "../helpers/csp_helper"

export class CodeLanguagePicker extends HTMLElement {
  #abortController = null

  connectedCallback() {
    this.editorElement = this.closest("lexxy-editor")
    this.editor = this.editorElement.editor
    this.classList.add("lexxy-floating-controls")
    this.#abortController = new AbortController()

    this.#attachLanguagePicker()
    this.#hide()
    this.#monitorForCodeBlockSelection()
  }

  disconnectedCallback() {
    this.dispose()
  }

  dispose() {
    this.#abortController?.abort()
    this.#abortController = null
    this.unregisterUpdateListener?.()
    this.unregisterUpdateListener = null
  }

  #attachLanguagePicker() {
    this.languagePickerElement = this.#findLanguagePicker() ?? this.#createLanguagePicker()

    const signal = this.#abortController.signal

    this.languagePickerElement.addEventListener("change", () => {
      this.#updateCodeBlockLanguage(this.languagePickerElement.value)
    }, { signal })

    this.languagePickerElement.addEventListener("mousedown", (event) => {
      this.#dispatchOpenEvent(event)
    }, { signal })

    this.languagePickerElement.setAttribute("nonce", getNonce())
    this.appendChild(this.languagePickerElement)
    this.#attachCopyButton()
  }

  #attachCopyButton() {
    const button = createElement("button", {
      type: "button",
      title: "Copy code",
      className: "lexxy-code-copy-button"
    })
    button.innerHTML = COPY_ICON

    const signal = this.#abortController.signal
    button.addEventListener("click", () => this.#copyCodeToClipboard(button), { signal })

    this.appendChild(button)
  }

  #copyCodeToClipboard(button) {
    // Use the hovered code element's text content directly — the click
    // may steal focus from the code block, making #getCurrentCodeNode() null.
    const codeElement = this.#hoveredCodeElement
    if (!codeElement) return

    const text = codeElement.textContent
    navigator.clipboard.writeText(text).then(() => {
      button.innerHTML = CHECK_ICON
      setTimeout(() => { button.innerHTML = COPY_ICON }, 1500)
    })
  }

  #findLanguagePicker() {
    return this.querySelector("select")
  }

  #createLanguagePicker() {
    const selectElement = createElement("select", { className: "lexxy-code-language-picker", "aria-label": "Pick a language…", name: "lexxy-code-language" })

    for (const [ value, label ] of Object.entries(this.#languages)) {
      const option = document.createElement("option")
      option.value = value
      option.textContent = label
      selectElement.appendChild(option)
    }

    return selectElement
  }

  get #languages() {
    const languages = { ...CODE_LANGUAGE_FRIENDLY_NAME_MAP }

    if (!languages.ruby) languages.ruby = "Ruby"
    if (!languages.php) languages.php = "PHP"
    if (!languages.go) languages.go = "Go"
    if (!languages.bash) languages.bash = "Bash"
    if (!languages.json) languages.json = "JSON"
    if (!languages.diff) languages.diff = "Diff"

    const sortedEntries = Object.entries(languages)
      .sort(([ , a ], [ , b ]) => a.localeCompare(b))

    // Place the "plain" entry first, then the rest of language sorted alphabetically
    const plainIndex = sortedEntries.findIndex(([ key ]) => key === "plain")
    const plainEntry = sortedEntries.splice(plainIndex, 1)[0]
    return Object.fromEntries([ plainEntry, ...sortedEntries ])
  }

  #dispatchOpenEvent(event) {
    const handled = !dispatch(this.editorElement, "lexxy:code-language-picker-open", {
      languages: this.#bridgeLanguages,
      currentLanguage: this.languagePickerElement.value
    }, true)

    if (handled) {
      event.preventDefault()
    }
  }

  get #bridgeLanguages() {
    return Object.entries(this.#languages).map(([ key, name ]) => ({ key, name }))
  }

  #updateCodeBlockLanguage(language) {
    this.editor.update(() => {
      const codeNode = this.#getCurrentCodeNode()

      if (codeNode) {
        codeNode.setLanguage(language)
      }
    })
  }

  #monitorForCodeBlockSelection() {
    this.unregisterUpdateListener = this.editor.registerUpdateListener(() => {
      this.editor.getEditorState().read(() => {
        const codeNode = this.#getCurrentCodeNode()

        if (codeNode) {
          this.#codeNodeWasSelected(codeNode)
        } else if (!this.#hoveredCodeElement) {
          this.#hide()
        }
      })
    })

    this.#monitorForCodeBlockHover()
  }

  #hoveredCodeElement = null

  #monitorForCodeBlockHover() {
    const signal = this.#abortController.signal
    const root = this.editor.getRootElement()
    if (!root) return

    root.addEventListener("mouseover", (event) => {
      const pre = event.target.closest("pre, code[data-language]")
      if (pre && pre !== this.#hoveredCodeElement) {
        this.#hoveredCodeElement = pre
        this.#positionLanguagePickerOnElement(pre)
        const language = pre.getAttribute("data-language") || pre.querySelector("[data-language]")?.getAttribute("data-language")
        if (language) this.#updateLanguagePickerWith(language)
        this.#show()
      }
    }, { signal })

    root.addEventListener("mouseout", (event) => {
      const pre = event.target.closest("pre, code[data-language]")
      if (!pre) return
      const movingTo = event.relatedTarget
      // Stay visible if moving to the picker controls or still inside the code block
      if (pre.contains(movingTo) || this.contains(movingTo)) return

      this.#hoveredCodeElement = null
      this.editor.getEditorState().read(() => {
        if (!this.#getCurrentCodeNode()) {
          this.#hide()
        }
      })
    }, { signal })

    // Keep visible when hovering the picker itself, hide when leaving
    this.addEventListener("mouseleave", (event) => {
      // If moving back into the code block, let the mouseover handler keep it visible
      if (this.#hoveredCodeElement?.contains(event.relatedTarget)) return

      this.#hoveredCodeElement = null
      this.editor.getEditorState().read(() => {
        if (!this.#getCurrentCodeNode()) {
          this.#hide()
        }
      })
    }, { signal })
  }

  #positionLanguagePickerOnElement(codeElement) {
    const codeRect = codeElement.getBoundingClientRect()
    const editorRect = this.editorElement.getBoundingClientRect()
    this.style.top = `${codeRect.top - editorRect.top}px`
    this.style.right = `${editorRect.right - codeRect.right}px`
  }

  #getCurrentCodeNode() {
    const selection = $getSelection()

    if (!$isRangeSelection(selection)) {
      return null
    }

    const anchorNode = selection.anchor.getNode()
    const parentNode = anchorNode.getParent()

    if ($isCodeNode(anchorNode)) {
      return anchorNode
    } else if ($isCodeNode(parentNode)) {
      return parentNode
    }

    return null
  }

  #codeNodeWasSelected(codeNode) {
    const language = codeNode.getLanguage()

    this.#updateLanguagePickerWith(language)
    this.#show()
    this.#positionLanguagePicker(codeNode)
  }

  #updateLanguagePickerWith(language) {
    if (this.languagePickerElement && language) {
      const normalizedLanguage = normalizeCodeLang(language)
      this.languagePickerElement.value = normalizedLanguage
    }
  }

  #positionLanguagePicker(codeNode) {
    const codeElement = this.editor.getElementByKey(codeNode.getKey())
    if (!codeElement) return

    const codeRect = codeElement.getBoundingClientRect()
    const editorRect = this.editorElement.getBoundingClientRect()
    const relativeTop = codeRect.top - editorRect.top
    const relativeRight = editorRect.right - codeRect.right

    this.style.top = `${relativeTop}px`
    this.style.right = `${relativeRight}px`
  }

  #show() {
    this.classList.add("visible")
  }

  #hide() {
    this.classList.remove("visible")
  }
}

export default CodeLanguagePicker

const COPY_ICON = `<svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round">
  <rect x="128" y="128" width="336" height="336" rx="57" ry="57" fill="none" />
  <path fill="none" stroke-linecap="round" d="M383.5,128l.5-24a56.16,56.16,0,0,0-56-56H112a64.19,64.19,0,0,0-64,64V328a56.16,56.16,0,0,0,56,56h24" />
</svg>`

const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="40" stroke-linecap="round" stroke-linejoin="round">
  <path fill="none" d="M416 128L192 384l-96-96" />
</svg>`
