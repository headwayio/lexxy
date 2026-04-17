import { COMMAND_PRIORITY_LOW, REDO_COMMAND, UNDO_COMMAND } from "lexical"

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

  // Register LOW-priority UNDO/REDO handlers. Returns an array of
  // unregister functions (push to a ListenerBin or cleanup array).
  //
  // LOW priority means Lexical's history plugin has already performed
  // the underlying undo/redo by the time we restore block selection.
  register(editor) {
    return [
      editor.registerCommand(UNDO_COMMAND, () => {
        if (this.#undoStack.length > 0) {
          this.#redoStack.push(this.#snapshot())
          const state = this.#undoStack.pop()
          requestAnimationFrame(() => this.#restore(state))
        }
        return false // don't prevent Lexical's undo
      }, COMMAND_PRIORITY_LOW),

      editor.registerCommand(REDO_COMMAND, () => {
        if (this.#redoStack.length > 0) {
          this.#undoStack.push(this.#snapshot())
          const state = this.#redoStack.pop()
          requestAnimationFrame(() => this.#restore(state))
        }
        return false // don't prevent Lexical's redo
      }, COMMAND_PRIORITY_LOW)
    ]
  }
}
