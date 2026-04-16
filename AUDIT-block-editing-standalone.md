# `block-editing-standalone` branch audit vs basecamp/main

> Generated 2026-04-16. Compared HEAD on `block-editing-standalone` against
> `origin/main` (= basecamp/lexxy) at `3d3b62eb`.
>
> **Branch posture:**
> - Fork point: `3735c0ad` ("Version 0.9.3.beta")
> - HEAD: 125 commits ahead of fork point
> - basecamp/main: 116 commits past fork point on its own line of work
> - `headwayio/main` and local `main` were both pinned at the fork point
>   when this audit was written; local `main` has since been retracked to
>   follow `origin/main` directly.
>
> Two huge net-new files: `block_selection_extension.js` (4499 lines),
> `block_actions_menu.js` (667 lines), plus `block_drag_and_drop.js`
> (2279 lines) and a refactored `attachment_controls.js` / preview
> pipeline. Five new Playwright test files added in this audit session
> (24 tests, all passing).

---

## Test work completed in this session

| File | Tests | Plan section |
|---|---|---|
| `test/browser/tests/block_editing/wrapped_block_origin.test.js` | 5 | P1.1 |
| `test/browser/tests/block_editing/single_undo_correctness.test.js` | 4 | P1.3 |
| `test/browser/tests/block_editing/table_block_select.test.js` | 5 | P1.4 |
| `test/browser/tests/block_editing/hr_block_select.test.js` | 4 | P1.5 |
| `test/browser/tests/block_editing/attachment_block_select.test.js` | 6 | P1.2 |

Block-editing suite: 79 → **103 tests** passing.

Two contract clarifications surfaced during implementation:

1. **The Cmd+/ menu's `table` rule disables every Turn into command.** The
   underlying multi-block conversion (commit fc4d137f) supports wrapping a
   table in a list/quote, but the menu restriction is
   `table: { commands: new Set(), color: true }` — so the wrap path is only
   reachable via a multi-block selection that anchors focus on a
   non-restricted block. Either widen the menu rule (allow `LISTS` +
   `insertQuoteBlock` like the `decorator` rule), or document the
   discrepancy as intentional.

2. **`setValue` always loads wrapped blocks as user-origin.** The fallback
   in `#isUserWrapped` means there's no way to test a movement-wrapped item
   without actually executing arrow movement to drift one in. Tests in
   `wrapped_block_origin.test.js` go through the drift sequence end-to-end.

P2 and P3 tests were not implemented — see `PLAN-block-editing-regression-tests.md` for the rest.

---

## 1. Things basecamp added after the fork point — pick what you want

(Not "you're behind." This branch developed in parallel with basecamp's
own line of work. These are upstream items worth considering on their own
merits, not because of any rebase pressure.)

### 1A — XSS in `CustomActionTextAttachmentNode` (HIGH severity, security)

`src/nodes/custom_action_text_attachment_node.js:77`

```js
createDOM() {
  const figure = createElement(this.tagName, { "content-type": ..., "data-lexxy-decorator": true })
  figure.insertAdjacentHTML("beforeend", this.innerHtml)   // unsanitized
  ...
}
```

basecamp commit `2ef7d8bc` wraps the call in `sanitize(...)`. `this.innerHtml` originates from `parseAttachmentContent(attachment.getAttribute("content"))` in `importDOM`, which does no sanitization. So `<action-text-attachment content="<img onerror=alert(1)>">` survives import and executes when the node renders. `CustomActionTextAttachmentNode` is registered at `src/elements/editor.js:338` and instantiated by mention/prompt insertion at `src/elements/prompt.js:459`.

**Fix:** import `sanitize` from `src/helpers/sanitization_helper.js` and wrap the `insertAdjacentHTML` call. Cherry-pick `2ef7d8bc` if the surrounding context still applies. Worth doing regardless of any rebase strategy.

### 1B — `link_opener_extension.js` (Cmd/Ctrl+click to open links) — MEDIUM

basecamp commit `20c95582` adds an extension that watches the modifier key and conditionally adds `target="_blank" rel="noopener noreferrer"` to anchors so plain Cmd+click opens links. Searching `src/` for `link-opener|LinkOpener|linkOpener` returns zero matches in our fork.

User-visible: Cmd+click on a link does nothing in our fork (or moves the caret).

**Fix:** cherry-pick the upstream extension. It depends on `registerEventListener` from basecamp's `listener_helper.js` (1D below) so either restore that helper or rewrite the extension to use raw listeners.

### 1C — `clearFormatting` command + button — MEDIUM

basecamp commit `3b683785` adds a "Clear formatting" toolbar button and `dispatchClearFormatting` to the dispatcher. Our `src/editor/command_dispatcher.js` has neither in its `COMMANDS` array nor a method. Users on our fork have no built-in way to strip inline styling from a selection.

### 1D — `listener_helper.js` (`registerEventListener` + `ListenerBin`) — MEDIUM

basecamp introduced a memory-safe listener registration helper:

```js
export function registerEventListener(element, type, listener, options) {
  element.addEventListener(type, listener, options)
  const elementRef = new WeakRef(element)
  const listenerRef = new WeakRef(listener)
  return () => {
    const listener = listenerRef.deref()
    if (listener) elementRef.deref()?.removeEventListener(type, listener, options)
  }
}

export class ListenerBin { ... }
```

Then converted every element/extension to use it (basecamp commits `3a9f25b2` through `b9457a32`). Our fork:

- Doesn't have the helper (it was added on basecamp's side after our fork point).
- Has **97 raw `addEventListener` calls** vs **63 raw `removeEventListener` calls** across `src/`. The 34-call gap suggests at least *some* listeners are never removed.
- Risky callers: `src/editor/block_drag_and_drop.js` (17 add — needs eyeballing); `src/elements/block_actions_menu.js` (8 add, 8 remove — balanced); `src/extensions/block_selection_extension.js` (7 add — most go through `cleanupFns`).

**Fix:** import the helper and migrate, or audit the 34-call gap to confirm none are leaks. Without `WeakRef` semantics, even paired add/remove can leak if an exception in between skips removal.

### 1E — Markdown `---` shorthand for HR — MEDIUM

basecamp has `src/editor/markdown/horizontal_divider_transformer.js`:

```js
export const HORIZONTAL_DIVIDER = {
  dependencies: [HorizontalDividerNode],
  regExpStart: /^-{3,}\s?$/,
  replace: (parentNode, ...) => { parentNode.replace(new HorizontalDividerNode()); ... }
}
```

We don't have it. We added a *different* transformer (`src/editor/markdown/list_heading_shortcut.js`) for `# `, `## `, `### `, `#### `, `> ` inside list items — additive, not a replacement. Users on our fork who type `---` and Enter get a literal `---` paragraph.

**Fix:** restore the transformer (basecamp commit `6f3344cc`).

### 1F — Lexical 0.41 → 0.42 dependency bump

Our `package.json` pins `^0.41.0`; basecamp uses `^0.42.0` (commit `f78352e7`, 16 lexical packages). Pinning to 0.41 is a defensible choice if we've validated against it; this is informational. Lexical 0.42 reportedly requires Node 22+ (Iterator helpers).

### 1G — Rails 8.2 `ActionText::Editor` adapter (#778)

basecamp commit `b9457a32` switches the engine to use Rails 8.2's `ActionText::Editor` adapter API when available, falling back to the prepend/monkey-patch on older Rails. Our `lib/lexxy/engine.rb` is still prepend-only. On Rails 8.2, our gem still works (prepend wins) but uses the deprecated path. Will eventually break.

### 1H — Smaller upstream changes

| Change | basecamp commit | Notes |
|---|---|---|
| Unwrap link dialog form | `9a4b622f` | UX polish on the link toolbar dropdown |
| Toolbar focus fix | `ae6c2757` | Prevents toolbar buttons from stealing focus |
| Link-change unwraps autolink | `3d3b62eb` | Edge case in `dropdown/link.js` |
| Prompt filtering tweaks | `7cef7351` | Empty-string-instead-of-null for link URL |

---

## 2. Suspected regressions and bugs in our own code

### 2A — Inconsistent `"history-push"` string literal vs `HISTORY_PUSH_TAG` constant — LOW (latent)

`src/extensions/block_selection_extension.js:1143, 1709` use the string literal `"history-push"`. The other two callsites (`1407`, `4316`) use the imported `HISTORY_PUSH_TAG` constant. The constant is already imported on line 21.

```js
// Line 1143
}, { tag: "history-push" })

// Line 4316
}, { tag: HISTORY_PUSH_TAG })
```

Lexical 0.41's `HISTORY_PUSH_TAG` happens to equal `"history-push"`, so this works today. If Lexical ever changes the value (which has happened — `HISTORY_MERGE_TAG` was renamed/reassigned previously), the two literal callsites silently produce the wrong undo behavior at exactly the locations the rest of the file works hardest to keep right.

**Fix:** replace both literals with `HISTORY_PUSH_TAG`. One-line change.

### 2B — Six `try { } catch (_) { /* ignore */ }` blocks — MEDIUM

`src/extensions/block_selection_extension.js`:

```js
// 1707
try { this.#resyncWrappedKeys() } catch (_) { /* nodes may have been removed */ }
// 1714, 1723
try { this.editor.update(...) } catch (_) { /* nodes may have been unwrapped/removed */ }
// 3231, 3244
try { /* lookup */ } catch (e) { /* ignore */ }
// 1501
try { insertAfterNode.insertAfter(clone) } catch (_) { /* fallback at root */ }
```

Each says "node may have been removed" but catches every error type. The 1707 callsite is in the hot `#moveSelectedBlocks` path — selection state corruption from a swallowed exception would be hard to attribute.

**Fix:** narrow the catches. For deleted-node cases, check `node.getParent() === null` or `$getNodeByKey(key) === null` *before* the operation. Keep the insert-fallback catch (1501) but log to `console.warn`.

### 2C — `#matchesKeySet` is O(N) per call, called O(M) times — MEDIUM (perf)

`src/extensions/block_selection_extension.js:3242`

```js
#matchesKeySet(node, keySet) {
  for (const key of keySet) {
    try {
      const tracked = $getNodeByKey(key)
      if (tracked && tracked.is(node)) return true
    } catch (e) { /* ignore */ }
  }
  return false
}
```

Called from `#isUserWrapped` (line 3214) which is called per block during sync. On a 200-block doc with 50 wrapped items, that's 10 000 lookups + try/catch instantiations per sync.

**Fix:** check `key === node.getKey()` directly first to avoid the inner $getNodeByKey. Drop the catch (`$getNodeByKey` returns null, doesn't throw, in current Lexical). Or store node refs / use a `WeakMap<node, true>`.

### 2D — Excessive `requestAnimationFrame` and double-RAF patterns — LOW (perf)

19 `requestAnimationFrame`/`setTimeout` calls in `block_selection_extension.js`. Several are double-RAF stacks:

```js
requestAnimationFrame(() => {
  this.#syncSelectionClasses()
  this.#syncWrappedBlockAttributes()
  requestAnimationFrame(() => {
    this.#dragAndDrop?.repositionHandle()
    this.#syncBulletOffsets()
    ...
  })
})
```

The pattern is documented (first RAF waits for Lexical reconciliation, second for layout) and probably necessary, but each user action defers up to 4 distinct frames of work. Recommend a manual perf pass on a doc with 500+ blocks and 50+ wrapped items before shipping.

### 2E — Per-call `#getDocumentOrderBlockKeys()` walks the entire document — LOW (perf)

`src/extensions/block_selection_extension.js:455`. Called from many sites. Each call does a recursive tree walk. Per-action this is `O(N)` once and fine; the risk is multi-block selections that loop through selected keys and call helpers per-key, accidentally producing `O(N×M)` walks. **Fix:** memoize per-`editor.update` boundary or pass the result as a param.

### 2F — `data-block-movement-wrapped` DOM attribute as origin source-of-truth — LOW (smell)

`#isWrappedBlock` falls back to reading `data-block-movement-wrapped` from the DOM:

```js
try {
  const el = this.editor.getElementByKey(key)
  if (el?.hasAttribute("data-block-movement-wrapped")) return true
} catch (e) { /* ignore */ }
```

A DOM attribute as source-of-truth for origin means a Turbo cache restore or server re-render could clear it, silently flipping movement-wrapped to user-wrapped. The `#isUserWrapped` doc comment acknowledges this with the "any unclassified wrapped block is user-wrapped" fallback, but the DOM attribute path adds a third source of truth that's harder to reason about.

---

## 3. Dead / orphaned code

### 3A — `lexxy_extension.js` lost 4 lines vs basecamp

Diff vs `origin/main` shows a removed `get allowedElements()` getter. Confirm no subclass relied on it (`grep -rn "allowedElements" src/`).

### 3B — `provisional_paragraph_extension.js` divergence

Our fork added `$addUpdateTag(HISTORY_MERGE_TAG)` inside `$markAllProvisionalParagraphsDirty`. The doc comment is excellent — explains why this is needed for the "two undo presses" bug. basecamp doesn't have this, but basecamp also doesn't have the block-actions menu. The change is correct and well-justified for our fork.

### 3C — `action_text_attachment_upload_node.js` is +49 lines vs basecamp

Confirm it doesn't conflict with basecamp's "keep cursor location when upload completes" patch (commit `b407c1b6`).

---

## 4. Style/pattern divergences from basecamp

### 4A — Raw `addEventListener`/`removeEventListener` everywhere — see 1D.

### 4B — `#scrollY` capture + `queueMicrotask(() => window.scrollTo(...))`

We have a one-off scroll-preservation pattern at multiple callsites. basecamp introduced a reusable `withPreservedScroll(handler)` wrapper in `command_dispatcher.js`. Cleaner to consolidate.

### 4C — Private method count in `block_selection_extension.js`

180 method definitions. The class is doing the work of 4–5 collaborators. See the separate refactor map (in conversation) for the proposed extraction order: `BlockSelectionState` → `WrappedOriginRegistry` → `HighlightInheritance` → `BlockActionsMenuController` → `WrappedBlockIndenter` → `BlockMovementEngine`.

### 4D — String tags vs constants (covered in 2A).

---

## 5. Test coverage gaps still open after this session

P1 items in the regression-test plan are now covered. Remaining work — see
`PLAN-block-editing-regression-tests.md`:

- **P2.1** Inline formatting in block-select multi-block (4 tests)
- **P2.2** Cmd+A escalation (3 tests)
- **P2.3** Cmd+D on wrapped blocks (2 tests)
- **P2.4** Color application on multi-block (5 tests)
- **P2.5** Mixed-selection Shift+Tab (1 test)
- **P3.1** Scroll preservation (7 tests)
- **P3.2** Block actions menu positioning/anchoring (3 tests)
- **P3.3** Keyboard navigation edge cases (3 tests)
- **Capybara round-trip** (9 tests in `test/system/`)

Audit-driven tests not in the plan that would also be valuable:
- A regression test that asserts `<action-text-attachment content="<img src=x onerror=...>">` cannot execute when imported (locks down 1A even after the fix lands).
- A test that types `---` followed by Enter and asserts a horizontal divider appears (will lock in the fix for 1E).
- A leak-detection test that creates and disposes 100 editors and asserts the listener count stays bounded (catches 1D regression).

---

## 6. Suggested triage / merge order

If this branch is being prepared for upstream contribution or for a release:

1. **Fix 1A (XSS) immediately.** One-line patch. Currently a security hole.
2. **Fix 2A** (string-tag literals) — trivial and removes a foot-gun.
3. **Pick up the small basecamp commits you want** (link-opener, clearFormatting, markdown HR shorthand) — each is small, additive, low-risk.
4. **Land the P2/P3 tests** (the rest of the regression plan).
5. **Decide on Lexical 0.42** and Rails 8.2 adapter strategy (1F, 1G).
6. **Refactor 4C / 2B / 2C** as part of a cleanup pass once the surface is stable.

---

## Files inspected for this audit

- `src/extensions/block_selection_extension.js` (4499 lines)
- `src/elements/block_actions_menu.js` (667 lines)
- `src/extensions/provisional_paragraph_extension.js`
- `src/editor/command_dispatcher.js`
- `src/nodes/custom_action_text_attachment_node.js`
- `src/nodes/wrapped_table_node.js`
- `src/editor/markdown/list_heading_shortcut.js`
- `src/helpers/sanitization_helper.js`
- `package.json`
- `test/browser/tests/block_editing/*.js` (existing tests for context)
