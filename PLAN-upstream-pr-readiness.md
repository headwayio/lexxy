# Plan: upstream PR readiness for block-editing-standalone

> Intent: land every P0/P1/P2 from the audit of the 15 topical commits on
> `block-editing-standalone` so the branch is ready for a PR to
> `basecamp/lexxy`. The user plans to hand-delete the PLAN/AUDIT/*.md files
> before pushing; we preserve them on this branch.
>
> Created 2026-04-16 after the audit, as a resume-anywhere task list.

## State — verify on resume

```bash
cd /Users/jon/Code/lexxy
git branch --show-current                 # block-editing-standalone
git rev-parse origin/main                 # 3d3b62eb…
git log --oneline origin/main..HEAD | wc -l  # should be 15 + however many audit-fix commits are already landed
git diff pre-rewrite-merged-state HEAD -- ':!PLAN-upstream-pr-readiness.md' | wc -l
#   0 before audit fixes start; grows as fixes land
ls /tmp/lexxy-merged-tree/                # snapshot from Phase 2 still present
```

If `branch-show-current` is not `block-editing-standalone`, stop — we may be on a worktree. If `log origin/main..HEAD` is <15, the rewrite rolled back — recover from `block-editing-standalone-pre-merge-rewrite-2026-04-16`.

## Backup branches (recovery)

- `block-editing-standalone-pre-merge-rewrite-2026-04-16` — pre-rewrite state (127 commits + merge)
- `backup/pre-merge-rewrite-2026-04-16` — earlier pre-merge state
- Tag `pre-rewrite-merged-state` — the merge commit before the rewrite

Before starting any risky task below, create `safety/audit-fix-<timestamp>` branch.

## Workflow for each task

1. Read the task section below. Confirm the file paths and line numbers still match before editing (lines drift if earlier tasks landed).
2. Make the change.
3. Run `./node_modules/.bin/eslint src/` — must be clean.
4. For JS behavior changes, verify the change by reading the surrounding code.
5. For Ruby changes, run `mise exec -- ruby -c <file>` to syntax check.
6. Stage with `git add <files>` (never `git add -A`).
7. Commit with the message template in each task section.
8. Mark the checkbox below.

At milestone boundaries (marked ★ below), run the full Playwright suite:
```bash
npx playwright test --config test/browser/playwright.config.js --project=chromium
```

## Progress checklist

### P0 — ship blockers
- [ ] P0-1: CSS class `lexxy-editor__block--*` rename
- [ ] P0-2: split `block_selection_extension.js` into `src/editor/block_selection/*`
- [ ] P0-3: split `block_drag_and_drop.js` into `src/editor/block_selection/drag_and_drop/*`
- [ ] P0-4: engine.rb — register helpers via `ActionController::Base.helper`
- [ ] P0-5: delete `Lexxy::AttachmentIconHelper` (derive label from extension or blob)
- [ ] P0-6: move SVG path constants out of `AttachmentHelper`
- [ ] P0-7: SVG fetch: cache object URL, revoke on destroy, dedupe poll by src
- [ ] P0-8: `indexOf` → `Map` in delete/duplicate/move (O(N²) → O(N))
- [x] P0-9: keep PLAN/AUDIT docs (deferred to user's pre-push cleanup)

★ milestone — run Playwright

### P1 — strongly recommended
- [ ] P1-1: collapse `#userWrappedKeys` + `#movementWrappedKeys` to one set
- [ ] P1-2: dedupe test helpers → `test/browser/helpers/{assertions,drag}.js`
- [ ] P1-3: remove `embed` from engine.rb allowed_tags
- [ ] P1-4: tighten `var()` CSS — scrubber or match `color/background-color` only
- [ ] P1-5: split `_blob.html.erb` into per-type partials
- [ ] P1-6: short-term — document the SVG allowlist; long-term ticket for Content-Disposition
- [ ] P1-7: `Extensions.prototype.get(klass)` + generalize `block-handles` attr
- [ ] P1-8: move `BlockActionsMenu.saveLastUsedColor` off the class (module-level or per-instance)
- [ ] P1-9: move `preview/{dialog_builder,playback_sync}.js` under `src/elements/preview/`
- [ ] P1-10: perf — track applied classes in Sets, drop `querySelectorAll` in `#syncSelection*`
- [ ] P1-11: perf — cache `#getNavigableBlockKeys()` per key event
- [ ] P1-12: perf — cache drag ancestor/snap points at `#startDrag`

★ milestone — run Playwright

### P2 — polish
- [ ] P2-1: `block_drag_and_drop.js` → `ListenerBin` instead of raw addEventListener
- [ ] P2-2: delete dead code (`ListItemNode` unused import, `dispatchCustomEvent`, `#ensureElementsCreated` eager create)
- [ ] P2-3: extract `#wrapInPreviewView` helper in attachment_node.js
- [ ] P2-4: drop duplicated `#backgroundUpdateTags` from upload node (inherits)
- [ ] P2-5: consolidate `extractFileExtension` helper
- [ ] P2-6: narrow empty catch blocks (7 occurrences)
- [ ] P2-7: move module-level `$provisionalTableEscapeKeys` Set onto an extension
- [ ] P2-8: simplify `#selectionUndoStack` or move to history command handlers
- [ ] P2-9: unify `COMMANDS` + `BLOCK_FORMAT_COMMANDS` to one map with flags
- [ ] P2-10: rename `PreviewModal.handlePreviewEvent` → `#handlePreviewEvent`

★ final milestone — run Playwright full suite + `yarn lint`

## Details

### P0-1. Rename unscoped `block--*` CSS classes

**Files**
- Source of truth constants: `src/editor/block_helpers.js:5-8`
- CSS rules: `app/assets/stylesheets/lexxy-editor.css` (~70 sites; search for `block--`, `block-selection-active`, `block--select-`, `block--flush-top`)
- JS consumers: every file that references the class names via imports from `block_helpers`

**Rename map** (be exact — some of these also appear as CSS selectors in JS template strings):
- `block--selected`           → `lexxy-editor__block--selected`
- `block--focused`            → `lexxy-editor__block--focused`
- `block--select-mid`         → `lexxy-editor__block--select-mid`
- `block--select-first`       → `lexxy-editor__block--select-first`
- `block--select-last`        → `lexxy-editor__block--select-last`
- `block--flush-top`          → `lexxy-editor__block--flush-top`
- `block-selection-active`    → `lexxy-editor--block-selection-active`  (root-level modifier)

**Strategy**
1. `grep -rn 'block--selected\|block--focused\|block--select-\|block--flush-top\|block-selection-active' src/ app/ test/` — list all call sites.
2. Update constants in `block_helpers.js` first.
3. Update JS files that reference class literals (query selectors, classList, template strings).
4. Update CSS file.
5. Run Playwright block-editing suite — any selector regressions appear fast.

**Commit**: `CSS: namespace block-select classes under lexxy-editor__*`

### P0-2. Split block_selection_extension.js

**Current**: `src/extensions/block_selection_extension.js` (4489 LOC, ~138 private methods, single class)

**Target**: `src/editor/block_selection/` subsystem
- `index.js` — coordinator; exports `BlockSelectionExtension`; constructs collaborators and registers Lexical callbacks. ~300 LOC.
- `keyboard.js` — `#handleKeydown` + escape/enter/delete/arrow handlers. ~400 LOC.
- `actions.js` — block-actions-menu glue, color apply, last-used-color helpers. ~200 LOC.
- `turn_into.js` — `#convertBlockType`, duplicate, format dispatch. ~400 LOC.
- `movement.js` — group-atomic move, promote/demote, normalize depth. ~1800 LOC.
- `highlight_propagation.js` — `#registerHighlightPropagation`, bullet-color sync. ~500 LOC.
- `wrapped_blocks.js` — `#indentWrappedBlock`, `#outdentWrappedBlock`, `#extractContentToRoot`. ~400 LOC.

`src/extensions/block_selection_extension.js` becomes a thin re-export.

**Strategy**
1. Create `src/editor/block_selection/` directory.
2. Copy the existing file to `.../index.js`.
3. Incrementally extract groups of methods into sibling files, each exported as a small utility/module.
4. In the coordinator, instantiate/inject as needed. Keep private fields on the coordinator; sibling modules take `ext` as first argument or receive a small state handle.
5. Top-level `block_selection_extension.js` shrinks to `export { BlockSelectionExtension } from "../editor/block_selection"`.
6. Lint, then run Playwright block-editing/* — must all pass.

**Commit**: `Block-select: split into src/editor/block_selection subsystem` (can be split into 3-4 commits if cleaner — one per module extracted)

### P0-3. Split block_drag_and_drop.js

**Current**: `src/editor/block_drag_and_drop.js` (2279 LOC)

**Target**: `src/editor/block_selection/drag_and_drop/`
- `index.js` — constructor + lifecycle. ~250 LOC.
- `handle.js` — grip/add-button DOM + `#positionHandle`. ~400 LOC.
- `ghost.js` — drag ghost element. ~250 LOC.
- `drop_target.js` — `#resolveDropTarget`, indicator positioning. ~500 LOC.
- `reparenting.js` — list-item/list rebuilds on drop. ~500 LOC.
- `autoscroll.js` — rAF scroll loop. ~200 LOC.

**Commit**: `Block-select: split drag-and-drop into subsystem modules`

### P0-4. Register helpers via ActionController::Base.helper

**File**: `lib/lexxy/engine.rb` — currently uses `ActionView::Base.include(Lexxy::AttachmentIconHelper)` and `.include(Lexxy::AttachmentHelper)` in `lexxy.attachable` initializer.

**Change**: replace with:
```ruby
initializer "lexxy.helpers" do |app|
  ActiveSupport.on_load(:action_controller_base) do
    helper Lexxy::AttachmentHelper
  end
end
```

(Only one helper if P0-5 lands first.)

**Commit**: `Engine: register Lexxy::AttachmentHelper via ActionController.helper`

### P0-5. Delete Lexxy::AttachmentIconHelper

**Files**
- Delete: `lib/lexxy/attachment_icon_helper.rb`
- Remove the `require_relative "attachment_icon_helper"` line in `lib/lexxy/engine.rb`
- Remove from `ActionView::Base.include` (will be handled by P0-4)
- Update `app/views/active_storage/blobs/_blob.html.erb:2` — `<% icon_label = attachment_icon_label(extension) %>` → inline `<% icon_label = extension.upcase %>` (or derive from a better method on Blob if adding one)

The richer extension→label map (PDF, ZIP, VID, etc.) only lives in JS; for the show-page partial the plain uppercase extension is probably fine. If the richer labels matter for the rendered view, move them onto `ActiveStorage::Blob` via a concern.

**Commit**: `Delete AttachmentIconHelper — inline upcase extension in blob partial`

### P0-6. Move SVG path constants out of AttachmentHelper

**File**: `lib/lexxy/attachment_helper.rb:8-9`

Constants `PREVIEW_ICON_PATH` and `DOWNLOAD_ICON_PATH` are 300-char SVG path strings. Move to:
- `app/assets/images/lexxy/preview.svg`
- `app/assets/images/lexxy/download.svg`

Render via `image_tag asset_path("lexxy/preview.svg"), ...` in the view partial, or via `inline_svg_tag` if an inline version is needed (for theming via currentColor).

Also: reconsider whether this helper needs to exist at all — its `lexxy_attachment_image_tag`, `lexxy_attachment_link_tag` methods may be simple enough to inline into the partial directly.

**Commit**: `Move attachment icon SVGs from Ruby constants to app/assets/images`

### P0-7. SVG fetch: cache, revoke, dedupe

**File**: `src/nodes/action_text_attachment_node.js`

Current issues (lines ~315-322 and #pollForPreview ~385-420):
1. `URL.createObjectURL(...)` leaked on every createDOM.
2. `fetch()` called on every render; no per-src dedupe.
3. Poll loop uses `&_=${Date.now()}` cache-buster — defeats CDN.
4. `setTimeout` IDs not tracked; not cleared on `destroy()`.

**Fix**
1. Add a module-level `const svgBlobUrlCache = new Map()` (key = src URL, value = object URL promise).
2. In the SVG branch: check cache before fetching; fetch lazily and memoize.
3. Add `destroy()` method on the node class that revokes the cached URL if no other node holds a reference — or keep a refcount. Minimum: revoke on page unload.
4. Drop `cacheBustedSrc` — use plain `this.src` for the poll.
5. Track `setTimeout` IDs in an instance field; clear in `destroy()` and when `!this.isAttached()`.

**Commit**: `Attachments: cache SVG object URLs, cancel polls on destroy`

### P0-8. Replace `indexOf` O(N²) with index Map

**File**: `src/extensions/block_selection_extension.js` (note: if P0-2 landed first, these move to `src/editor/block_selection/*.js`)

**Sites**
- Line ~938, 942 (delete): `Math.max(...[ ...selectedSet ].map(k => allKeys.indexOf(k)))`
- Line ~1471 (duplicate): sort by `allKeys.indexOf`
- Line ~1692 (move): sort by `allKeys.indexOf`

**Fix**: build `const idxByKey = new Map(allKeys.map((k, i) => [k, i]))` once; use `idxByKey.get(k)`.

**Commit**: `Block-select: O(1) key-to-index lookup for delete/duplicate/move`

### P1-1. Collapse #userWrappedKeys + #movementWrappedKeys

**File**: `src/extensions/block_selection_extension.js:50-57` and related helpers ~3140-3241. The only observable difference: movement-wrapped auto-unwraps on exit, user-wrapped persists.

**Fix**: replace the two Sets with a single `#wrappedKeys: Set<string>`. The "unwrap on exit" rule becomes a single check at outdent time rather than an origin-tag lookup. Delete the DOM `data-block-movement-wrapped` attribute pairing; if a movement-wrapped block persists past the next selection-change, clear it from the set.

Expect ~150 LOC removed and ~15 helper methods deleted (`#trackUserWrapped`, `#trackMovementWrapped`, `#rebuildOriginSet`, `#isUserWrapped`, `#matchesKeySet`, `#syncWrappedBlockAttributes`, `#resyncWrappedKeys`, `#wrappedBlockKeys`).

**Commit**: `Block-select: unify wrapped-block key tracking to one Set`

### P1-2. Dedupe test helpers

**Files**
- `test/browser/helpers/assertions.js` — already has `assertEditorHtml`; add `stripDynamicAttrs` + `assertBlockHtml` (superset regex including `data-block-movement-wrapped` if P1-1 didn't already remove that attribute).
- New: `test/browser/helpers/drag.js` — exports `dragBlock(page, from, to, { offsetX } = {})` with full fidelity.
- Remove local copies from every file under `test/browser/tests/block_editing/` that duplicates them.

**Commit**: `Tests: extract shared block-editing test helpers`

### P1-3. Remove `embed` from allowed_tags

**File**: `lib/lexxy/engine.rb:~68`

Remove `embed` from `allowed_tags` array. No code uses `<embed>`; it opens a phishing vector.

**Commit**: `Engine: drop <embed> from allowed_tags — unused, phishing surface`

### P1-4. Tighten `var()` CSS allowlist

**Files**: `lib/lexxy/engine.rb:~84` (adds `var` to `ALLOWED_CSS_FUNCTIONS`).

Option A (preferred): write a Loofah scrubber that rejects `var(...)` whose arguments contain `url(`, `javascript`, or `expression(`. Keep `var` on the function allowlist.

Option B: pair the allowlist entry with a restricted `ALLOWED_CSS_PROPERTIES = %w[color background-color]` so `var()` in any other property is stripped.

Add a comment at the allowlist entry explaining the attack surface.

**Commit**: `Engine: scrub var() arguments to prevent CSS-smuggling`

### P1-5. Split _blob.html.erb into per-type partials

**File**: `app/views/active_storage/blobs/_blob.html.erb` — currently has `if blob.video?` / `elsif blob.audio?` / `elsif content-type allowlist` / `elsif representable?` / `else`.

**Fix**: Replace with:
```erb
<%= render partial: blob_partial_for(blob), locals: { blob:, in_gallery: local_assigns[:in_gallery] } %>
```

Add `blob_partial_for(blob)` on a blob helper:
```ruby
def blob_partial_for(blob)
  case
  when blob.video? then "active_storage/blobs/blob_video"
  when blob.audio? then "active_storage/blobs/blob_audio"
  when blob.image? then "active_storage/blobs/blob_image"
  when blob.representable? then "active_storage/blobs/blob_preview"
  else "active_storage/blobs/blob_file"
  end
end
```

Create 5 partials, each 6–10 lines, no conditionals.

**Commit**: `Blob partial: split into per-content-type sub-partials`

### P1-6. Document SVG allowlist; file upstream issue for Content-Disposition

Short-term: add a comment at `lib/lexxy/engine.rb:~67` explaining why SVG primitives are allowlisted and that this is a workaround for ActiveStorage's SVG Content-Disposition behavior.

Long-term (not in this PR): file an issue — either on lexxy or Rails — to serve SVG inline for trusted origins so the allowlist can shrink. Out of scope for this branch; just note it in the comment.

**Commit**: `Engine: document SVG allowlist rationale`

### P1-7. Extensions.prototype.get + generalized attribute observer

**Files**
- `src/editor/extensions.js` — add `get(klass)` helper.
- `src/elements/editor.js:112, 142-149` — replace 3× inline `instanceof` lookup with `this.extensions.get(BlockSelectionExtension)`.

Also: generalize the `block-handles` attribute. Let extensions declare observed attributes:
```js
class BlockSelectionExtension extends LexxyExtension {
  static observedAttributes = { "block-handles": "setShowHandles" }
}
```
`LexicalEditorElement.attributeChangedCallback` dispatches to any extension that claims the attribute, then fallback to built-ins.

**Commit**: `Extensions: add get(klass) + generalize extension-owned attributes`

### P1-8. Move BlockActionsMenu.saveLastUsedColor off the class

**Files**
- `src/elements/block_actions_menu.js` — remove static method + state.
- `src/elements/dropdown/highlight.js:74` — read/write from the new home.
- `src/helpers/storage_helper.js` OR `src/editor/block_selection/actions.js` — new home; use `localStorage` for persistence or a Map keyed by editor instance for per-instance.

Preferred: per-instance on the block-select extension; `localStorage` if cross-editor persistence is desired, but that's a separate choice.

**Commit**: `BlockActionsMenu: move last-used-color state off the class`

### P1-9. Move preview modules under src/elements/preview/

**Files**
- Move `src/preview/dialog_builder.js` → `src/elements/preview/dialog_builder.js`
- Move `src/preview/playback_sync.js` → `src/elements/preview/playback_sync.js`
- Keep `src/preview/content_preview.js` as-is (it's a standalone bundle entry in `rollup.config.mjs`).
- Update imports in `src/elements/preview_modal.js` and `src/preview/content_preview.js`.

**Commit**: `Preview: colocate dialog_builder/playback_sync with preview_modal`

### P1-10. Track applied classes in Sets; drop querySelectorAll in selection sync

**Files**: `src/extensions/block_selection_extension.js:339-407, 1851-1928` (or the split module if P0-2 landed).

**Fix**
- Maintain `#appliedGroupClasses: Map<key, Set<className>>` so removal can iterate the map instead of `root.querySelectorAll(".block--select-first, ...")`.
- Batch DOM reads (rect/computed-style) before writes to avoid forced reflow.

**Commit**: `Block-select: track applied classes in Map; remove querySelectorAll from hot path`

### P1-11. Cache #getNavigableBlockKeys per key event

**File**: `src/extensions/block_selection_extension.js:454-533, 502, 509`

**Fix**: compute `const keys = this.#getNavigableBlockKeys()` once in the ArrowUp/Down keydown handler, then pass it to `#getNextBlockKey`/`#getPreviousBlockKey` as an argument. Remove the re-read + `indexOf` from those helpers (pair with P0-8 for index Map).

**Commit**: `Block-select: compute navigable keys once per key event`

### P1-12. Cache drag invariants at #startDrag

**File**: `src/editor/block_drag_and_drop.js:620-638, 872` (or split path)

**Fix**: at `#startDrag`, read and cache:
- The dragged block's ancestor list chain and their `getBoundingClientRect().left`.
- `#getDropSnapPoints()` of the dragged node — these don't change during a drag.

Read cached values from `#onDragMove`. For the drop target resolver: don't call `listElement.querySelectorAll("li")` + per-child `getBoundingClientRect` — either cache the child layout or use `elementFromPoint` + climb.

**Commit**: `Block-drag: cache drag invariants at startDrag; avoid per-frame querySelectorAll`

### P2-1. ListenerBin in block_drag_and_drop.js

**File**: `src/editor/block_drag_and_drop.js` (or split path)

Replace ~24 raw `addEventListener` + matching `removeEventListener` pairs with `ListenerBin` + `registerEventListener`. Consolidate the 3 teardown paths (lines ~2249, 829, 809).

**Commit**: `Block-drag: use ListenerBin for consistency with BlockSelectionExtension`

### P2-2. Dead code

- `src/extensions/block_selection_extension.js:30` — remove `ListItemNode` from the import list (only the `$is*`/`$create*` helpers are used).
- `src/helpers/html_helper.js:64-70` — delete `dispatchCustomEvent` (0 call sites; `dispatch` is a superset).
- `src/editor/block_drag_and_drop.js` — remove `#ensureElementsCreated` lazy-creation; create handle + add-button + drop-indicator in the constructor.

**Commit**: `Delete dead code: unused import, unused helper, unused lazy-init`

### P2-3. Extract #wrapInPreviewView

**File**: `src/nodes/action_text_attachment_node.js:116-142`

```js
#wrapInPreviewView(...children) {
  const previewView = createElement("div", { className: "attachment__preview-view" })
  children.forEach(child => previewView.appendChild(child))
  return previewView
}
```

Collapse the three branches to single-line appends.

**Commit**: `Attachment node: extract #wrapInPreviewView helper`

### P2-4. Drop duplicate #backgroundUpdateTags

**Files**: `src/nodes/action_text_attachment_node.js:360-369` and `.../action_text_attachment_upload_node.js:224-239` — byte-identical getters. Upload inherits from attachment; delete the child copy.

**Commit**: `Upload node: inherit #backgroundUpdateTags from attachment node`

### P2-5. Consolidate extractFileExtension

**Files**: pattern `fileName.split(".").pop().toLowerCase()` appears in:
- `src/helpers/html_helper.js:22` (`createAttachmentFigure`)
- `src/nodes/action_text_attachment_node.js:510` (`#fileExtension`)
- `src/nodes/action_text_attachment_upload_node.js:113` (`#getFileExtension`)
- `src/preview/dialog_builder.js:217` (`fileExtension`)

Consolidate to `extractFileExtension(fileName)` in `src/helpers/storage_helper.js` (already owns `extractFileName`).

**Commit**: `Helpers: consolidate extractFileExtension`

### P2-6. Narrow empty catch blocks

**File**: `src/extensions/block_selection_extension.js:1083, 1500, 1706, 1722, 3225, 3238` (7 sites)

Replace `catch (e) { /* ignore */ }` with one of:
- `catch (e) { if (LexicalEditorElement.debug) console.debug(e) }`
- Or narrow to expected error (e.g., stale-key access: `if (e?.message?.includes("key"))`).

**Commit**: `Block-select: log swallowed errors in debug mode`

### P2-7. Move $provisionalTableEscapeKeys onto TablesExtension

**File**: `src/nodes/wrapped_table_node.js:8` — module-level mutable Set shared across every editor.

Move state onto `TablesExtension` instance; pass through via the extension's context or an injected handle.

**Commit**: `Wrapped table: scope provisional-escape state to TablesExtension instance`

### P2-8. Simplify #selectionUndoStack

**File**: `src/extensions/block_selection_extension.js:60-61, 1957-1986` + ~8 `pushSelectionHistory()` call sites.

Option A: consolidate pushes into `UNDO_COMMAND`/`REDO_COMMAND` handler interception — push once before dispatching, not at every mutation site.

Option B: use a Lexical NodeSelection marker so the core history plugin restores it automatically.

Option A is lower risk.

**Commit**: `Block-select: consolidate selection-history pushes at UNDO command boundary`

### P2-9. Unify COMMANDS + BLOCK_FORMAT_COMMANDS

**File**: `src/editor/command_dispatcher.js:32, 64`

Replace parallel arrays with one map:
```js
const COMMANDS = {
  bold: { scroll: "native" },
  applyUnorderedListFormat: { scroll: "preserve" },
  // ...
}
```

Callers read flags from the single source.

**Commit**: `CommandDispatcher: unify command registry with per-command flags`

### P2-10. PreviewModal.#handlePreviewEvent

**File**: `src/elements/preview_modal.js:16` — rename `this.handlePreviewEvent` to `this.#handlePreviewEvent` to match the rest of the file's `#` convention.

**Commit**: `PreviewModal: rename handlePreviewEvent to match private-field convention`

## Validation

After all tasks:
```bash
./node_modules/.bin/eslint src/                           # must be clean
mise exec -- ruby -c lib/lexxy/*.rb                       # all OK
npx playwright test --config test/browser/playwright.config.js --project=chromium  # all pass
mise exec -- bin/rails test:all                            # if applicable
git log --oneline origin/main..HEAD                       # review final history
```

Estimated final commit count: ~35 (15 from rewrite + 1 lint + ~19 audit fixes, some combined).

## Rollback

At any point:
```bash
git reset --hard HEAD~<N>                    # local undo
git checkout block-editing-standalone-pre-merge-rewrite-2026-04-16  # full rollback
```

Never push without explicit user approval.
