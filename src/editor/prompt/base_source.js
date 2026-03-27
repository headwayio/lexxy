import { createElement, generateDomId, parseHtml } from "../../helpers/html_helper"

export default class BaseSource {
  // Template method to override
  async buildListItems(filter = "") {
    return Promise.resolve([])
  }

  // Template method to override
  promptItemFor(listItem) {
    return null
  }

  // Protected

  buildListItemElementFor(promptItemElement, isFiltering = false) {
    const template = promptItemElement.querySelector("template[type='menu']")
    const fragment = template.content.cloneNode(true)
    const listItemElement = createElement("li", { role: "option", id: generateDomId("prompt-item"), tabindex: "0" })
    listItemElement.classList.add("lexxy-prompt-menu__item")
    listItemElement.appendChild(fragment)

    if (isFiltering) {
      const filterSuffix = promptItemElement.getAttribute("data-filter-suffix")
      if (filterSuffix) {
        const label = listItemElement.querySelector(".lexxy-slash-command__label")
        if (label) {
          const suffixEl = createElement("span")
          suffixEl.classList.add("lexxy-slash-command__filter-suffix")
          suffixEl.textContent = ` \u00b7 ${filterSuffix}`
          label.appendChild(suffixEl)
        }
      }
    }

    return listItemElement
  }

  async loadPromptItemsFromUrl(url) {
    try {
      const response = await fetch(url)
      const html = await response.text()
      const promptItems = parseHtml(html).querySelectorAll("lexxy-prompt-item")
      return Promise.resolve(Array.from(promptItems))
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
