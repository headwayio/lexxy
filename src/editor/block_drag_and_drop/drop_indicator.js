import { createElement } from "../../helpers/html_helper"

// DOM lifecycle for the drop-indicator element (a horizontal line with a
// circle on its left end, positioned between blocks during a drag to show
// where the block will land on release). The coordinator computes the
// target coordinates; this class just owns the element and the show/hide
// class toggle. Short-circuits near-duplicate calls so adjacent targets
// with sub-5px movement don't flicker.
export class DropIndicator {
  #element
  #lastTop = null
  #lastLeft = null

  constructor(editorElement) {
    editorElement.querySelector(".lexxy-drop-indicator")?.remove()

    const indicator = createElement("div", {
      className: "lexxy-drop-indicator",
      "aria-hidden": "true"
    })
    indicator.appendChild(createElement("div", { className: "lexxy-drop-indicator__circle" }))
    indicator.appendChild(createElement("div", { className: "lexxy-drop-indicator__line" }))

    this.#element = indicator
    editorElement.appendChild(indicator)
  }

  show({ top, left, right, gap, depth, listType }) {
    // Skip if the indicator would barely move — prevents flicker between
    // adjacent "after A" / "before B" targets at the same depth.
    if (this.#lastTop !== null && Math.abs(top - this.#lastTop) < 5 && Math.abs(left - this.#lastLeft) < 5) {
      return
    }
    this.#lastTop = top
    this.#lastLeft = left

    this.#element.style.top = `${top}px`
    this.#element.style.left = `${left}px`
    this.#element.style.right = `${right}px`
    this.#element.style.setProperty("--indicator-gap", `${Math.max(0, gap)}px`)

    this.#element.dataset.depth = depth
    this.#element.dataset.listType = listType || ""

    this.#element.classList.add("lexxy-drop-indicator--visible")
  }

  hide() {
    this.#element?.classList.remove("lexxy-drop-indicator--visible")
    this.#lastTop = null
    this.#lastLeft = null
  }

  destroy() {
    this.#element?.remove()
  }
}
