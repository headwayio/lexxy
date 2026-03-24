import BaseSource from "./base_source"
import { filterMatches } from "../../helpers/string_helper"
import { createElement } from "../../helpers/html_helper"

export default class LocalFilterSource extends BaseSource {
  async buildListItems(filter = "") {
    const promptItems = await this.fetchPromptItems()
    return this.#buildListItemsFromPromptItems(promptItems, filter)
  }

  // Template method to override
  async fetchPromptItems(filter) {
    return Promise.resolve([])
  }

  promptItemFor(listItem) {
    return this.promptItemByListItem.get(listItem)
  }

  #buildListItemsFromPromptItems(promptItems, filter) {
    const listItems = []
    this.promptItemByListItem = new WeakMap()

    // Group items by section, preserving order of first appearance
    const sections = []
    const sectionMap = new Map()

    for (const promptItem of promptItems) {
      const section = promptItem.getAttribute("data-section") || ""
      if (!sectionMap.has(section)) {
        const group = { name: section, items: [] }
        sectionMap.set(section, group)
        sections.push(group)
      }
      sectionMap.get(section).items.push(promptItem)
    }

    for (const { name, items } of sections) {
      const matchingItems = []

      for (const promptItem of items) {
        const searchableText = promptItem.getAttribute("search")
        if (!filter || filterMatches(searchableText, filter)) {
          const listItem = this.buildListItemElementFor(promptItem)
          this.promptItemByListItem.set(listItem, promptItem)
          matchingItems.push(listItem)
        }
      }

      if (matchingItems.length > 0) {
        // Insert section header if the section has a name
        if (name) {
          listItems.push(this.#buildSectionHeader(name))
        }
        listItems.push(...matchingItems)
      }
    }

    return listItems
  }

  #buildSectionHeader(name) {
    const header = createElement("li", { role: "presentation" })
    header.classList.add("lexxy-prompt-menu__section-header")
    header.textContent = name
    return header
  }
}
