import { COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_LOW, REDO_COMMAND, UNDO_COMMAND } from "lexical"

// Parallel undo/redo stack for block-selection state. Lexical's history
// plugin captures editor state but not block-selection metadata (mode,
// selected keys, anchor/focus), so we mirror it here and restore after
// Lexical's handler runs.
//
// The owning extension keeps the snapshot/restore logic private (those
// closures touch extension-private state like #selectedBlockKeys); this
// module just owns the stacks and the UNDO/REDO command registration.
export class SelectionHistory {
  #undoStack = []
  #redoStack = []
  #snapshot
  #restore

  // snapshot: () => stateObject
  // restore:  (stateObject) => void
  constructor({ snapshot, restore }) {
    this.#snapshot = snapshot
    this.#restore = restore
  }

  // Save current block selection state before an undoable operation.
  // Call this before editor.update() in indent/outdent and block moves.
  push() {
    this.#undoStack.push(this.#snapshot())
    this.#redoStack = []
  }

  // Register UNDO/REDO handlers at TWO priorities:
  //
  //   HIGH: runs BEFORE Lexical's history plugin reverts the tree.
  //         We don't claim the command (return false) — we just
  //         observe to capture the user's pre-undo scroll position.
  //         Lexical's reconciler typically calls scrollIntoView on
  //         the restored selection, which jumps the page if the
  //         pre-undo scroll spot wasn't where that selection lives.
  //         Capturing scroll here, before the revert and reconciler
  //         run, lets us restore it after they finish.
  //
  //   LOW:  runs AFTER Lexical's history plugin and reconciler.
  //         Pops the parallel snapshot, restores block-selection
  //         state, and (in the same rAF) restores the captured
  //         scroll position so the page doesn't visibly jump.
  register(editor) {
    let preUndoScroll = null
    let preRedoScroll = null

    function captureScroll() {
      return { x: window.scrollX, y: window.scrollY }
    }

    return [
      editor.registerCommand(UNDO_COMMAND, () => {
        preUndoScroll = captureScroll()
        return false // observe only
      }, COMMAND_PRIORITY_HIGH),

      editor.registerCommand(REDO_COMMAND, () => {
        preRedoScroll = captureScroll()
        return false
      }, COMMAND_PRIORITY_HIGH),

      editor.registerCommand(UNDO_COMMAND, () => {
        const scroll = preUndoScroll
        preUndoScroll = null
        if (this.#undoStack.length > 0) {
          this.#redoStack.push(this.#snapshot())
          const state = this.#undoStack.pop()
          requestAnimationFrame(() => {
            this.#restore(state)
            if (scroll) window.scrollTo(scroll.x, scroll.y)
          })
        } else if (scroll) {
          // No JS-side state to restore, but still suppress
          // scrollIntoView jumps from Lexical's restored selection.
          requestAnimationFrame(() => window.scrollTo(scroll.x, scroll.y))
        }
        return false // don't prevent Lexical's undo
      }, COMMAND_PRIORITY_LOW),

      editor.registerCommand(REDO_COMMAND, () => {
        const scroll = preRedoScroll
        preRedoScroll = null
        if (this.#redoStack.length > 0) {
          this.#undoStack.push(this.#snapshot())
          const state = this.#redoStack.pop()
          requestAnimationFrame(() => {
            this.#restore(state)
            if (scroll) window.scrollTo(scroll.x, scroll.y)
          })
        } else if (scroll) {
          requestAnimationFrame(() => window.scrollTo(scroll.x, scroll.y))
        }
        return false // don't prevent Lexical's redo
      }, COMMAND_PRIORITY_LOW)
    ]
  }
}
