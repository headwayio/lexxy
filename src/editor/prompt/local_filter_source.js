import BaseSource from "./base_source"
import fuzzysort from "fuzzysort"
import { createElement } from "../../helpers/html_helper"
import { filterMatchPosition } from "../../helpers/string_helper"

const MAX_RENDERED_SUGGESTIONS = 100

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
    // Command palettes (slash menu) carry data-command and want fuzzy matching;
    // mention-style prompts keep word-boundary matching ordered by position.
    const isCommandPalette = promptItems.some(item => item.hasAttribute("data-command"))
    if (!isCommandPalette) {
      return this.#buildPositionFilteredResults(promptItems, filter)
    }

    const listItems = []
    const targets = promptItems.map(promptItem => ({
      promptItem,
      search: promptItem.getAttribute("search")
    }))

    const results = fuzzysort.go(filter, targets, { key: "search", limit: MAX_RENDERED_SUGGESTIONS })

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

  #buildPositionFilteredResults(promptItems, filter) {
    const matches = []
    for (const promptItem of promptItems) {
      const searchableText = promptItem.getAttribute("search")
      const position = filterMatchPosition(searchableText, filter)
      if (position >= 0) {
        matches.push({ promptItem, position })
      }
    }

    matches.sort((a, b) => a.position - b.position)

    const listItems = []
    for (const { promptItem } of matches) {
      if (listItems.length >= MAX_RENDERED_SUGGESTIONS) break
      const listItem = this.buildListItemElementFor(promptItem)
      this.promptItemByListItem.set(listItem, promptItem)
      listItems.push(listItem)
    }
    return listItems
  }

  #buildSectionedResults(promptItems) {
    const listItems = []
    const sections = []
    const sectionMap = new Map()
    let renderedCount = 0

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
      if (renderedCount >= MAX_RENDERED_SUGGESTIONS) break
      if (name) {
        listItems.push(this.#buildSectionHeader(name))
      }
      for (const promptItem of items) {
        if (renderedCount >= MAX_RENDERED_SUGGESTIONS) break
        const listItem = this.buildListItemElementFor(promptItem, false)
        this.promptItemByListItem.set(listItem, promptItem)
        listItems.push(listItem)
        renderedCount++
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
