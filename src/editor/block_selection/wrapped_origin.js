import { $getNodeByKey, $isDecoratorNode, $isElementNode, $isParagraphNode } from "lexical"
import { $isListItemNode, $isListNode } from "@lexical/list"
import { getNodeKeyFromElement } from "../block_helpers"

// Tracks which list-item keys are "wrapped blocks" — ListItemNodes that
// wrap a non-paragraph block (heading, quote, code, table, HR, attachment)
// instead of holding inline text. Origin matters because of divergent
// outdent behavior:
//
//   user-wrapped     — applied by Turn-into, persists across outdent-to-root
//   movement-wrapped — auto-created during group moves, auto-unwraps on exit
//
// Lexical node keys can change under us via copy-on-write. We defend
// against that with two mechanisms:
//
//   1. syncDOMAttributes() writes data-block-movement-wrapped to each
//      tracked element with its origin. If a key changes, the attribute
//      survives and we recover the new key from the DOM on the next sync.
//   2. resync(selectedKeys) rebuilds both Sets filtering by
//      $getNodeByKey, preserving origin for keys still resolvable.
export class WrappedOriginTracker {
  #userKeys = new Set()
  #movementKeys = new Set()
  #editor

  constructor(editor) {
    this.#editor = editor
  }

  trackUser(key) {
    this.#userKeys.add(key)
    this.#movementKeys.delete(key)
  }

  trackMovement(key) {
    // Don't demote user-wrapped to movement-wrapped. If a user-wrapped item
    // happens to travel through movement code paths, preserve its origin.
    if (this.#userKeys.has(key)) return
    this.#movementKeys.add(key)
  }

  untrack(key) {
    this.#userKeys.delete(key)
    this.#movementKeys.delete(key)
  }

  // True iff `key` is currently in the movement-wrapped set (direct key
  // match only; no DOM attribute or content-heuristic fallback). Call
  // before untrack() when you need to know whether an unwrap is
  // "releasing" a movement-wrapped item.
  hasMovementKey(key) {
    return this.#movementKeys.has(key)
  }

  isUser(listItemNode) {
    const key = listItemNode.getKey()
    if (this.#userKeys.has(key)) return true
    if (this.#matchesKeySet(listItemNode, this.#userKeys)) return true
    if (this.#movementKeys.has(key)) return false
    if (this.#matchesKeySet(listItemNode, this.#movementKeys)) return false
    // Fallback: any wrapped block we can't classify is treated as user-wrapped.
    // Reasoning: documents loaded from storage have no origin marker, but
    // anything saved as a wrapped block was committed by the user (either via
    // Turn-into or by saving a movement-wrapped item, which implicitly
    // promotes it to user-wrapped). Movement-wrapped is a transient session
    // state that lives only between consecutive movements within one session.
    return this.isWrapped(listItemNode)
  }

  // Check if a ListItemNode wraps a non-paragraph block (either origin).
  // Used for shared logic where origin doesn't matter (e.g. content-heuristic
  // rendering). Origin-sensitive callers should use isUser() instead.
  isWrapped(listItemNode) {
    const key = listItemNode.getKey()
    if (this.#userKeys.has(key) || this.#movementKeys.has(key)) return true

    // Content heuristic: a single block-level child (heading, code block, table,
    // HR, etc.) means this list item is wrapping a non-list block that entered
    // via block movement. Matches ElementNodes (heading, code, table) and
    // DecoratorNodes (HR, images). Excludes inline TextNodes, ParagraphNode, ListNode.
    const children = listItemNode.getChildren()
    if (children.length === 1
        && ($isElementNode(children[0]) || $isDecoratorNode(children[0]))
        && !$isListNode(children[0]) && !$isParagraphNode(children[0])) {
      return true
    }

    // If this node is the one we're actively moving (selected/focused),
    // check the DOM attribute from the previous render. Lexical can throw
    // on stale keys mid-mutation; fall through to key-set matching below.
    try {
      const el = this.#editor.getElementByKey(key)
      if (el?.hasAttribute("data-block-movement-wrapped")) return true
    } catch { /* stale key — fall through */ }

    // Also check all tracked keys to see if any resolve to this node
    // (keys may have changed due to copy-on-write)
    return this.#matchesKeySet(listItemNode, this.#userKeys)
      || this.#matchesKeySet(listItemNode, this.#movementKeys)
  }

  // Rebuild both origin sets after an update that may have invalidated keys.
  // `selectedKeys` is the caller's current selection, used to preserve origin
  // when a selected node's key changes (e.g. its parent ListItem was the
  // tracked one and copy-on-write gave it a new key).
  resync(selectedKeys) {
    this.#userKeys = this.#rebuild(this.#userKeys, selectedKeys)
    this.#movementKeys = this.#rebuild(this.#movementKeys, selectedKeys)
  }

  // Re-apply data-block-movement-wrapped DOM attribute after moves. The
  // attribute's VALUE carries origin ("user" or "movement") so copy-on-write
  // key changes can be recovered into the right origin set on the next call.
  syncDOMAttributes() {
    const root = this.#editor.getRootElement()
    if (!root) return

    // Apply attribute from known keys, tagging with origin.
    for (const key of this.#userKeys) {
      const el = this.#editor.getElementByKey(key)
      if (el) el.dataset.blockMovementWrapped = "user"
      else this.#userKeys.delete(key)
    }
    for (const key of this.#movementKeys) {
      const el = this.#editor.getElementByKey(key)
      if (el) el.dataset.blockMovementWrapped = "movement"
      else this.#movementKeys.delete(key)
    }

    // Also scan DOM for attribute-tagged elements whose keys aren't in
    // either set (key changed due to copy-on-write). Recover into the
    // origin set indicated by the attribute value.
    for (const el of root.querySelectorAll("[data-block-movement-wrapped]")) {
      const key = getNodeKeyFromElement(el)
      if (!key) continue
      const origin = el.dataset.blockMovementWrapped
      if (origin === "user") {
        if (!this.#userKeys.has(key)) this.trackUser(key)
      } else {
        // Legacy "" values and "movement" both recover as movement-wrapped.
        if (!this.#userKeys.has(key) && !this.#movementKeys.has(key)) {
          this.trackMovement(key)
        }
      }
    }
  }

  #rebuild(originSet, selectedKeys) {
    const rebuilt = new Set()
    for (const key of originSet) {
      if ($getNodeByKey(key)) rebuilt.add(key)
    }
    // If a selected node's old key lived in this origin set, preserve the
    // new key with the same origin.
    for (const key of selectedKeys) {
      const node = $getNodeByKey(key)
      if (!node) continue
      if ($isListItemNode(node) && originSet.has(key)) {
        rebuilt.add(key)
      }
      if (node.getParent && $isListItemNode(node.getParent())) {
        const parentKey = node.getParent().getKey()
        if (originSet.has(parentKey)) rebuilt.add(parentKey)
      }
    }
    return rebuilt
  }

  #matchesKeySet(node, keySet) {
    // Keys can go stale via copy-on-write — $getNodeByKey throws in that
    // case. Skip missing keys silently; the caller tolerates false negatives.
    for (const key of keySet) {
      try {
        const tracked = $getNodeByKey(key)
        if (tracked && tracked.is(node)) return true
      } catch { /* stale key */ }
    }
    return false
  }
}
