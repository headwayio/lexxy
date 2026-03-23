import { $getNearestNodeFromDOMNode } from "lexical"
import { createElement } from "../helpers/html_helper"

const DELETE_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M11.2041 1.01074C12.2128 1.113 13 1.96435 13 3V4H15L15.1025 4.00488C15.6067 4.05621 16 4.48232 16 5C16 5.55228 15.5523 6 15 6H14.8457L14.1416 15.1533C14.0614 16.1953 13.1925 17 12.1475 17H5.85254L5.6582 16.9902C4.76514 16.9041 4.03607 16.2296 3.88184 15.3457L3.8584 15.1533L3.1543 6H3C2.44772 6 2 5.55228 2 5C2 4.44772 2.44772 4 3 4H5V3C5 1.89543 5.89543 1 7 1H11L11.2041 1.01074ZM5.85254 15H12.1475L12.8398 6H5.16016L5.85254 15ZM7 4H11V3H7V4Z"/>
</svg>`

const PREVIEW_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2H5C3.89543 2 3 2.89543 3 4V14C3 15.1046 3.89543 16 5 16H13C14.1046 16 15 15.1046 15 14V7H12C10.8954 7 10 6.10457 10 5V2ZM12 2.41421L14.5858 5H12V2.41421ZM5 1C3.34315 1 2 2.34315 2 4V14C2 15.6569 3.34315 17 5 17H13C14.6569 17 16 15.6569 16 14V6.41421C16 6.01639 15.842 5.63486 15.5607 5.35355L11.6464 1.43934C11.3651 1.15804 10.9836 1 10.5858 1H5Z"/>
</svg>`

const EDIT_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M13.5858 1.58579C14.3668 0.804738 15.6332 0.804738 16.4142 1.58579C17.1953 2.36683 17.1953 3.63317 16.4142 4.41421L6.41421 14.4142C6.14935 14.6791 5.82269 14.8735 5.46487 14.9793L2.28306 15.9193C1.81048 16.059 1.32955 15.8584 1.09763 15.4527C0.916167 15.1359 0.940981 14.7489 1.13617 14.4638L1.02073 14.717L2.02073 12.5352C2.12653 12.1774 2.32089 11.8507 2.58579 11.5858L12.5858 1.58579ZM15 3L14.4142 2.41421L4 12.8284L3.28306 14.717L5.17157 14L15.5858 3.58579L15 3Z"/>
</svg>`

const DOWNLOAD_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 1C9.55228 1 10 1.44772 10 2V9.58579L12.2929 7.29289C12.6834 6.90237 13.3166 6.90237 13.7071 7.29289C14.0976 7.68342 14.0976 8.31658 13.7071 8.70711L9.70711 12.7071C9.31658 13.0976 8.68342 13.0976 8.29289 12.7071L4.29289 8.70711C3.90237 8.31658 3.90237 7.68342 4.29289 7.29289C4.68342 6.90237 5.31658 6.90237 5.70711 7.29289L8 9.58579V2C8 1.44772 8.44772 1 9 1ZM3 14C3 13.4477 2.55228 13 2 13C1.44772 13 1 13.4477 1 14V15C1 16.1046 1.89543 17 3 17H15C16.1046 17 17 16.1046 17 15V14C17 13.4477 16.5523 13 16 13C15.4477 13 15 13.4477 15 14V15H3V14Z"/>
</svg>`

const COLLAPSE_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 4C2.44772 4 2 4.44772 2 5C2 5.55228 2.44772 6 3 6H15C15.5523 6 16 5.55228 16 5C16 4.44772 15.5523 4 15 4H3ZM3 8C2.44772 8 2 8.44772 2 9C2 9.55228 2.44772 10 3 10H15C15.5523 10 16 9.55228 16 9C16 8.44772 15.5523 8 15 8H3ZM2 13C2 12.4477 2.44772 12 3 12H10C10.5523 12 11 12.4477 11 13C11 13.5523 10.5523 14 10 14H3C2.44772 14 2 13.5523 2 13Z"/>
</svg>`

const EXPAND_ICON = `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3C2 2.44772 2.44772 2 3 2H6C6.55228 2 7 2.44772 7 3V6C7 6.55228 6.55228 7 6 7H3C2.44772 7 2 6.55228 2 6V3ZM4 4V5H5V4H4ZM9 3C9 2.44772 9.44772 2 10 2H15C15.5523 2 16 2.44772 16 3C16 3.55228 15.5523 4 15 4H10C9.44772 4 9 3.55228 9 3ZM9 6C9 5.44772 9.44772 5 10 5H13C13.5523 5 14 5.44772 14 6C14 6.55228 13.5523 7 13 7H10C9.44772 7 9 6.55228 9 6ZM2 11C2 10.4477 2.44772 10 3 10H6C6.55228 10 7 10.4477 7 11V14C7 14.5523 6.55228 15 6 15H3C2.44772 15 2 14.5523 2 14V11ZM4 12V13H5V12H4ZM10 10C9.44772 10 9 10.4477 9 11C9 11.5523 9.44772 12 10 12H15C15.5523 12 16 11.5523 16 11C16 10.4477 15.5523 10 15 10H10ZM9 14C9 13.4477 9.44772 13 10 13H13C13.5523 13 14 13.4477 14 14C14 14.5523 13.5523 15 13 15H10C9.44772 15 9 14.5523 9 14Z"/>
</svg>`

export class NodeDeleteButton extends HTMLElement {
  connectedCallback() {
    this.editorElement = this.closest("lexxy-editor")
    this.editor = this.editorElement.editor
    this.classList.add("lexxy-floating-controls")

    if (!this.querySelector(".lexxy-node-delete")) {
      this.#attachButtons()
    }
  }

  disconnectedCallback() {
    this.editor = null
    this.editorElement = null
  }

  #attachButtons() {
    const container = createElement("div", { className: "lexxy-floating-controls__group" })
    const fileUrl = this.dataset.fileUrl
    const fileName = this.dataset.fileName
    const contentType = this.dataset.contentType

    if (fileUrl) {
      const previewButton = createElement("button", {
        type: "button",
        className: "lexxy-node-action",
        "aria-label": "Open"
      })
      previewButton.tabIndex = -1
      previewButton.dataset.tooltip = "Open"
      previewButton.dataset.tooltipPosition = "below"
      previewButton.innerHTML = PREVIEW_ICON
      previewButton.addEventListener("click", (e) => {
        e.stopPropagation()
        this.#dispatchPreviewEvent(fileUrl, fileName, contentType)
      })
      container.appendChild(previewButton)

      if (this.#isEditable(contentType)) {
        const editButton = createElement("button", {
          type: "button",
          className: "lexxy-node-action",
          "aria-label": "Edit"
        })
        editButton.tabIndex = -1
        editButton.dataset.tooltip = "Edit"
        editButton.dataset.tooltipPosition = "below"
        editButton.innerHTML = EDIT_ICON
        editButton.addEventListener("click", (e) => {
          e.stopPropagation()
          this.#dispatchEditEvent(fileUrl, fileName, contentType)
        })
        container.appendChild(editButton)
      }

      const downloadLink = createElement("a", {
        href: fileUrl,
        download: fileName || "",
        className: "lexxy-node-action",
        "aria-label": "Download"
      })
      downloadLink.tabIndex = -1
      downloadLink.dataset.tooltip = "Download"
      downloadLink.dataset.tooltipPosition = "below"
      downloadLink.innerHTML = DOWNLOAD_ICON
      downloadLink.addEventListener("click", (e) => e.stopPropagation())
      container.appendChild(downloadLink)

      if (this.dataset.previewable === "true") {
        const isCollapsed = this.closest("figure.attachment")?.classList.contains("attachment--collapsed")
        const toggleButton = createElement("button", {
          type: "button",
          className: "lexxy-node-action",
          "aria-label": isCollapsed ? "Show preview" : "Collapse to card"
        })
        toggleButton.tabIndex = -1
        toggleButton.dataset.tooltip = isCollapsed ? "Show preview" : "Collapse"
        toggleButton.dataset.tooltipPosition = "below"
        toggleButton.innerHTML = isCollapsed ? EXPAND_ICON : COLLAPSE_ICON
        toggleButton.addEventListener("click", (e) => {
          e.stopPropagation()
          const figure = this.closest("figure.attachment")
          if (figure) {
            figure.classList.toggle("attachment--collapsed")
            const nowCollapsed = figure.classList.contains("attachment--collapsed")
            toggleButton.innerHTML = nowCollapsed ? EXPAND_ICON : COLLAPSE_ICON
            toggleButton.setAttribute("aria-label", nowCollapsed ? "Show preview" : "Collapse to card")
            toggleButton.dataset.tooltip = nowCollapsed ? "Show preview" : "Collapse"

            this.editor.update(() => {
              const node = $getNearestNodeFromDOMNode(this)
              if (node) {
                node.getWritable().collapsed = nowCollapsed
              }
            })
          }
        })
        container.appendChild(toggleButton)
      }
    }

    this.deleteButton = createElement("button", {
      className: "lexxy-node-delete",
      type: "button",
      "aria-label": "Remove"
    })
    this.deleteButton.tabIndex = -1
    this.deleteButton.dataset.tooltip = "Remove"
    this.deleteButton.dataset.tooltipPosition = "below"
    this.deleteButton.innerHTML = DELETE_ICON

    this.handleDeleteClick = () => this.#deleteNode()
    this.deleteButton.addEventListener("click", this.handleDeleteClick)
    container.appendChild(this.deleteButton)

    this.appendChild(container)
  }

  #isEditable(contentType) {
    if (!contentType) return false
    return contentType.startsWith("text/") ||
      contentType === "application/json" ||
      contentType === "application/csv"
  }

  #dispatchEditEvent(fileUrl, fileName, contentType) {
    this.editorElement.dispatchEvent(new CustomEvent("lexxy:edit-attachment", {
      bubbles: true,
      detail: { fileUrl, fileName, contentType }
    }))
  }

  #dispatchPreviewEvent(fileUrl, fileName, contentType) {
    this.editorElement.dispatchEvent(new CustomEvent("lexxy:preview-attachment", {
      bubbles: true,
      detail: { fileUrl, fileName, contentType }
    }))
  }

  #deleteNode() {
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(this)
      node?.remove()
    })
  }
}

export default NodeDeleteButton
