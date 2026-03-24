import BaseSource from "./base_source"
import fuzzysort from "fuzzysort"
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
    this.promptItemByListItem = new WeakMap()

    if (filter.length > 0) {
      return this.#buildFilteredResults(promptItems, filter)
    } else {
      return this.#buildSectionedResults(promptItems)
    }
  }

  #buildFilteredResults(promptItems, filter) {
    const listItems = []
    const targets = promptItems.map(promptItem => ({
      promptItem,
      search: promptItem.getAttribute("search")
    }))

    const results = fuzzysort.go(filter, targets, { key: "search" })

    if (results.length > 0) {
      listItems.push(this.#buildSectionHeader("Filtered results"))
      for (const result of results) {
        const listItem = this.buildListItemElementFor(result.obj.promptItem, true)
        this.promptItemByListItem.set(listItem, result.obj.promptItem)
        listItems.push(listItem)
      }
    }

    return listItems
  }

  #buildSectionedResults(promptItems) {
    const listItems = []
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
      if (name) {
        listItems.push(this.#buildSectionHeader(name))
      }
      for (const promptItem of items) {
        const listItem = this.buildListItemElementFor(promptItem, false)
        this.promptItemByListItem.set(listItem, promptItem)
        listItems.push(listItem)
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
