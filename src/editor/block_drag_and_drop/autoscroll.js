// How close to a container edge (px) before auto-scroll starts.
const SCROLL_EDGE_SIZE = 60

// Maximum auto-scroll speed (px per animation frame). Actual speed ramps up
// quadratically as the pointer approaches the container edge.
const SCROLL_MAX_SPEED = 15

// Auto-scroll the nearest scrollable ancestor (or the viewport) when the
// pointer is near an edge during a drag. Instantiated once by the block
// drag coordinator; started when a drag begins, stopped on cleanup.
//
// The caller provides two callbacks:
//   getPointer() → { x, y, isDragging } — polls current pointer state.
//   onScroll(x, y)                      — fires after each scroll step so
//                                         the caller can update hover state
//                                         relative to the new layout.
export class AutoScroll {
  #editorElement
  #getPointer
  #onScroll
  #rafId = null
  #scrollableContainers = null
  #stickyTopOffset = 0

  constructor(editorElement, { getPointer, onScroll }) {
    this.#editorElement = editorElement
    this.#getPointer = getPointer
    this.#onScroll = onScroll
  }

  start() {
    this.#scrollableContainers = this.#findScrollableContainers()
    if (!this.#rafId) {
      this.#rafId = requestAnimationFrame(this.#tick)
    }
  }

  stop() {
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId)
      this.#rafId = null
    }
    this.#scrollableContainers = null
  }

  #findScrollableContainers() {
    const containers = []
    let current = this.#editorElement.parentElement

    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current)
      const overflowY = style.overflowY
      if ((overflowY === "auto" || overflowY === "scroll") &&
          current.scrollHeight > current.clientHeight) {
        containers.push(current)
      }
      current = current.parentElement
    }

    // Always include viewport (window-level scrolling)
    containers.push(null)

    // Detect sticky/fixed headers that occlude the top of the viewport.
    // Probe from the top center downward; for each hit element, walk its
    // ancestor chain to find any fixed/sticky container.
    this.#stickyTopOffset = 0
    const probeX = window.innerWidth / 2
    for (let y = 0; y < 200; y += 4) {
      const el = document.elementFromPoint(probeX, y)
      if (!el) continue

      let fixedAncestor = null
      let walk = el
      while (walk && walk !== document.documentElement) {
        const pos = getComputedStyle(walk).position
        if (pos === "fixed" || pos === "sticky") {
          fixedAncestor = walk
          break
        }
        walk = walk.parentElement
      }

      if (fixedAncestor) {
        const bottom = fixedAncestor.getBoundingClientRect().bottom
        if (bottom > this.#stickyTopOffset) this.#stickyTopOffset = bottom
      } else {
        break
      }
    }

    return containers
  }

  #getScrollSpeed(distFromEdge) {
    if (distFromEdge >= SCROLL_EDGE_SIZE || distFromEdge < 0) return 0
    const ratio = 1 - (distFromEdge / SCROLL_EDGE_SIZE)
    return Math.round(SCROLL_MAX_SPEED * ratio * ratio)
  }

  #tick = () => {
    const { x: clientX, y: clientY, isDragging } = this.#getPointer()
    if (!isDragging) {
      this.#rafId = null
      return
    }

    let didScroll = false

    for (const container of this.#scrollableContainers) {
      const isViewport = container === null

      const rect = isViewport
        ? { top: this.#stickyTopOffset, bottom: window.innerHeight, left: 0, right: window.innerWidth }
        : container.getBoundingClientRect()

      if (clientX < rect.left || clientX > rect.right) continue

      // Check if pointer can actually scroll this container
      const canScrollUp = isViewport ? window.scrollY > 0 : container.scrollTop > 0
      const canScrollDown = isViewport
        ? (window.scrollY + window.innerHeight) < document.documentElement.scrollHeight
        : (container.scrollTop + container.clientHeight) < container.scrollHeight

      const distFromTop = clientY - rect.top
      if (canScrollUp && distFromTop >= 0 && distFromTop < SCROLL_EDGE_SIZE) {
        const speed = this.#getScrollSpeed(distFromTop)
        if (speed > 0) {
          if (isViewport) {
            window.scrollBy(0, -speed)
          } else {
            container.scrollTop -= speed
          }
          didScroll = true
        }
      }

      const distFromBottom = rect.bottom - clientY
      if (canScrollDown && distFromBottom >= 0 && distFromBottom < SCROLL_EDGE_SIZE) {
        const speed = this.#getScrollSpeed(distFromBottom)
        if (speed > 0) {
          if (isViewport) {
            window.scrollBy(0, speed)
          } else {
            container.scrollTop += speed
          }
          didScroll = true
        }
      }
    }

    // Scrolling moved elements relative to the pointer — update drop target
    if (didScroll) {
      this.#onScroll(clientX, clientY)
    }

    this.#rafId = requestAnimationFrame(this.#tick)
  }
}
