# Plan: merge upstream + rewrite as a clean linear branch

> Intent: produce a `block-editing-standalone` branch whose history is purely
> additive on top of the current `origin/main` (basecamp) tip, with the same
> end-state tree that a full conflict-resolved merge would produce.
>
> Created 2026-04-16 after aborting an interactive rebase that hit conflict
> #6 (semantic conflict in `src/editor/contents.js` and `src/elements/editor.js`)
> at commit 18/132. Snapshot of that aborted attempt is in
> `/tmp/lexxy-rebase-snapshot/`.

## Pre-flight state (verify before starting)

Run from repo root:

```bash
git status                                # working tree clean
git log --oneline -3                      # top 3 should be:
#   8f46bd56 AUDIT doc: block-editing-standalone vs basecamp/main
#   459d5e7c Block-select: regression tests for P1 capability gaps
#   f2f7072e PLAN doc: regression test coverage for block-editing-standalone
git rev-parse origin/main                 # 3d3b62eb… (basecamp tip)
git rev-parse HEAD                        # 8f46bd56…
git log --oneline 3735c0ad..HEAD | wc -l  # 127 (commits ahead of fork point)
git log --oneline HEAD..origin/main | wc -l  # 116 (basecamp commits we don't have)
ls test/browser/tests/block_editing/wrapped_block_origin.test.js  # tests intact
ls AUDIT-block-editing-standalone.md      # audit intact
```

If any of those don't match, **stop** — the snapshot is stale; do not proceed.

## Snapshot contents (reference material)

`/tmp/lexxy-rebase-snapshot/`:
- `done.txt` — full list of picks completed during the aborted rebase
- `todo-remaining.txt` — picks that were still queued
- `last-rebased-head.txt` — SHA of detached HEAD at abort time
- `resolved-commit-shas.txt` — last 5 successfully resolved commits
- `in-progress-contents.js` — `src/editor/contents.js` with conflict markers (the one that triggered the pause)
- `in-progress-editor.js` — `src/elements/editor.js` with conflict markers
- `rebase-merge-dir/` — full copy of `.git/rebase-merge` for forensics

The 5 conflict resolutions we did during the aborted rebase are reachable
via reflog (`git reflog | grep "rebase"`) — useful as references when the
same files conflict during the upcoming merge.

---

## Phase 1 — Establish the ground-truth tree (merge upstream)

The goal here is **not** to produce the final branch. It's to produce the
correct *end-state tree* that the rewrite must match.

```bash
# Safety branch in case anything goes sideways:
git branch backup/pre-merge-rewrite-2026-04-16

# Bring local main up to basecamp:
git checkout main
git pull --ff-only                                # main → 3d3b62eb
git checkout block-editing-standalone

# Merge basecamp's 116 commits into our branch:
git merge origin/main                             # will halt on conflicts
```

**Expected conflicts** (based on the rebase attempt — same files, but
presented all at once instead of per-commit):

| File | Nature |
|---|---|
| `eslint.config.js` | Additive — keep both globals lists (basecamp's `Image`, ours: 7 more globals) |
| `src/elements/editor.js` | Imports + extension list + `#initialize` body — keep both (basecamp's `LinkOpenerExtension`, `#configureSanitizer`; ours: `BlockSelectionExtension`, `extensions.initializeEditors`) |
| `src/elements/dropdown/highlight.js` | Imports + lifecycle — basecamp converted to `track(registerEventListener(...))`; ours uses raw `addEventListener`. Take basecamp's pattern, add our `BlockActionsMenu` import |
| `src/elements/toolbar_dropdown.js` | Same listener_helper modernization as highlight.js — take basecamp |
| `src/editor/command_dispatcher.js` | Imports — keep basecamp's `ListenerBin/registerEventListener` + our `getListItemNode` (only if our blocks code still needs it; otherwise just `getListType`). Plus possibly `clearFormatting` in COMMANDS array — basecamp added it |
| `app/assets/stylesheets/lexxy-editor.css` | Both sides added link-dropdown rules and a `&[data-clipped-at-right]` selector — combine |
| `src/editor/contents.js` | **Hard one.** basecamp added `applyUnorderedListFormat`/`applyOrderedListFormat`/`clearFormatting`. Ours added `#findParentListItem`/`#wrapListItemInBlock`/`#applyCodeBlockFormat`. Conflict block ends with both sides' new methods — and the post-conflict body refers to identifiers from one side. Tracing required. |

For each conflict file, the resolution pattern is:
1. **Open the file** and `grep -n "<<<<<<< "` to count markers.
2. For each marker block, ask: "is this conflict between things that *should both exist* (additive) or between things that *replace each other* (semantic)?"
3. If additive → take both sides, merging cleanly.
4. If semantic → read the surrounding 30+ lines on each side to understand intent, then either preserve our newer behavior or basecamp's, whichever supersedes.
5. Verify with `grep -n "<<<<<<< "` returning empty.
6. `git add <file>`.

After all conflicts are resolved:

```bash
git status                              # "All conflicts fixed but you are still merging."
GIT_EDITOR=true git commit              # accepts the default merge commit message
```

Now you have HEAD on `block-editing-standalone` with:
- All 127 of your block-editing commits *plus*
- All 116 basecamp commits *plus*
- One merge commit at the tip

The **tree** at this commit is the ground truth.

---

## Phase 2 — Snapshot the ground-truth tree

```bash
mkdir -p /tmp/lexxy-merged-tree
git archive HEAD | tar -x -C /tmp/lexxy-merged-tree
git rev-parse HEAD > /tmp/lexxy-merged-tree/.merged-head-sha.txt

# Sanity: confirm new tests + audit doc are present in the archive.
ls /tmp/lexxy-merged-tree/AUDIT-block-editing-standalone.md
ls /tmp/lexxy-merged-tree/test/browser/tests/block_editing/wrapped_block_origin.test.js
```

This `/tmp/lexxy-merged-tree/` is the *target* — Phase 4 must produce a tree
that matches it byte-for-byte.

Tag the merge commit so it's recoverable later:

```bash
git tag pre-rewrite-merged-state HEAD
```

---

## Phase 3 — Reset to a clean basecamp baseline

Branch off basecamp, leaving the merge commit intact for diff comparison:

```bash
git checkout -b block-editing-rewrite origin/main
git status                              # should be clean
git rev-parse HEAD                      # should equal origin/main (3d3b62eb)
```

The original `block-editing-standalone` is unchanged. The merge tag is preserved. The new branch starts from a basecamp baseline.

---

## Phase 4 — Rebuild the additive commits

Strategy: copy files from `/tmp/lexxy-merged-tree/` into the working tree
in topical groups, commit each group with a descriptive message. The order
below is dependency-aware (helpers first, extensions/elements that use them
next, integration last, tests last).

Each step:
1. Copy the listed files from `/tmp/lexxy-merged-tree/<path>` to `./<path>`.
2. `git diff --stat` to confirm only the expected files changed.
3. `git add` the changes, then commit with a clear message.

### 4.1 — Helpers and shared utilities

```
src/editor/block_helpers.js              (new file)
src/helpers/storage_helper.js            (modified)
src/helpers/string_helper.js             (modified)
src/helpers/text_node_export_helper.js   (modified)
src/helpers/timing_helpers.js            (deleted, if applicable)
src/helpers/lexical_helper.js            (modified — adds getListItemNode if our code needs it)
```

Commit: `Block helpers: shared constants, list-item lookup, storage utilities`

### 4.2 — New nodes

```
src/nodes/wrapped_table_node.js          (new)
src/nodes/horizontal_divider_node.js     (modified)
src/nodes/early_escape_code_node.js      (modified)
src/nodes/early_escape_list_item_node.js (new — verify name)
src/nodes/image_gallery_node.js          (modified)
src/nodes/action_text_attachment_node.js (modified — large diff)
src/nodes/action_text_attachment_upload_node.js (modified)
src/nodes/custom_action_text_attachment_node.js (modified — XSS fix consideration: confirm sanitize() is in the merged version; the audit flagged this as missing on our fork)
```

Commit: `Nodes: WrappedTable, refined attachment lifecycle, image gallery`

### 4.3 — Block selection extension (the big one)

```
src/extensions/block_selection_extension.js  (new — 4499 lines)
src/extensions/provisional_paragraph_extension.js  (modified — adds HISTORY_MERGE_TAG fix)
```

Commit: `Block-select extension: multi-block selection, movement, formatting`

### 4.4 — Block actions menu

```
src/elements/block_actions_menu.js            (new — 667 lines)
```

Commit: `Block actions menu: Cmd+/ menu with Turn into / Color / Duplicate / Delete`

### 4.5 — Block drag and drop

```
src/editor/block_drag_and_drop.js             (new — 2279 lines)
```

Commit: `Block drag-and-drop: handle, ghost, drop targeting`

### 4.6 — Editor element + element index integration

```
src/elements/editor.js                        (modified — registers BlockSelectionExtension)
src/elements/index.js                         (modified)
src/index.js                                  (modified)
src/editor/extensions.js                      (modified)
```

Commit: `Editor element: wire block-select extension and lifecycle`

### 4.7 — Toolbar / dropdown / preview / attachments integration

```
src/elements/toolbar.js                       (modified)
src/elements/toolbar_dropdown.js              (modified)
src/elements/dropdown/highlight.js            (modified — adds BlockActionsMenu integration)
src/elements/dropdown/link.js                 (modified)
src/elements/code_language_picker.js          (modified)
src/elements/attachment_controls.js           (new)
src/elements/attachment_icons.js              (new)
src/elements/preview_modal.js                 (new)
src/elements/prompt.js                        (modified)
src/elements/table/table_controller.js        (modified)
src/elements/table/table_tools.js             (modified)
src/elements/toolbar_icons.js                 (modified)
src/preview/content_preview.js                (new)
src/preview/dialog_builder.js                 (new)
src/preview/playback_sync.js                  (new)
```

Commit: `Toolbar/dropdown/preview integration with block selection`

### 4.8 — Tables, highlight, command dispatcher refinements

```
src/extensions/highlight_extension.js         (modified)
src/extensions/tables_extension.js            (modified)
src/extensions/attachments_extension.js       (modified)
src/extensions/lexxy_extension.js             (modified)
src/editor/command_dispatcher.js              (modified)
src/editor/selection.js                       (modified)
src/editor/markdown/list_heading_shortcut.js  (new)
src/editor/prompt/local_filter_source.js      (modified)
src/editor/prompt/remote_filter_source.js     (modified)
```

Commit: `Extensions and dispatcher: integrate block-select with formatting/tables/highlight`

### 4.9 — Helpers refinements

```
src/helpers/accessibility_helper.js           (modified)
src/helpers/code_highlighting_helper.js       (modified)
src/helpers/html_helper.js                    (modified)
src/helpers/sanitization_helper.js            (modified)
```

Commit: `Helpers: a11y, code highlighting, HTML, sanitization adjustments`

### 4.10 — Server-side and configuration

```
lib/lexxy/                                   (any modified files)
app/assets/stylesheets/lexxy-editor.css      (modified — large CSS additions for block selection / drag-drop / handles)
app/assets/javascript/                       (built assets if modified — check carefully, may want to exclude)
ext/                                         (any modified files)
test/dummy/                                  (modified files in dummy app)
```

Commit: `CSS, server-side helpers, dummy app updates for block editing`

### 4.11 — Documentation cleanup

```
README.md, docs/...                          (any modified files)
```

Commit: `Docs: block editing reference, attachment helpers`

### 4.12 — Move (don't recreate) the existing test commits and audit doc

The two commits from the previous session (test files + audit doc) are
already on `block-editing-standalone`. Cherry-pick them onto the new
linear branch:

```bash
git cherry-pick 459d5e7c   # Block-select: regression tests for P1 capability gaps
git cherry-pick 8f46bd56   # AUDIT doc: block-editing-standalone vs basecamp/main
```

### 4.13 — Tests for non-regression-test files

```
test/browser/tests/block_editing/block_actions_menu.test.js   (new)
test/browser/tests/block_editing/block_api.test.js            (new)
test/browser/tests/block_editing/block_drag_and_drop.test.js  (new)
test/browser/tests/block_editing/block_movement_hierarchy.test.js (new)
test/browser/tests/block_editing/block_selection.test.js      (new)
test/browser/tests/block_editing/drop_edge.test.js            (new)
test/browser/tests/block_editing/drop_freeze.test.js          (new)
test/browser/tests/block_editing/drop_reparent.test.js        (new)
test/browser/tests/block_editing/wrapped_block_outdent.test.js (new)
# Plus modifications to many other test files
```

Commit: `Tests: block selection / drag-and-drop / movement / wrapped outdent suites`

### 4.14 — Other modified test files and configs

```
test/browser/tests/<various>.test.js          (modifications)
test/browser/helpers/<various>.js             (modifications)
test/browser/fixtures/<various>.html          (modifications)
test/system/<various>.rb                      (modifications)
vitest.config.js                              (modified)
yarn.lock                                     (modified — dependency changes)
package.json                                  (any modifications)
```

Commit: `Test fixtures, helpers, config updates`

---

## Phase 5 — Validate the rewrite matches the merged tree

```bash
# This MUST be empty (or only show files we intentionally excluded):
diff -r /tmp/lexxy-merged-tree . \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=tmp \
  --exclude=app/assets/javascript    # exclude built assets
```

If diff shows differences:
- Files only in `/tmp/lexxy-merged-tree/` → we missed copying them. Add them in a follow-up commit.
- Files only in `.` → we accidentally added something extra; remove it.
- Different content → we missed an edit; reconcile.

Iterate until diff is empty (modulo intended exclusions).

Then verify the tests still pass:

```bash
yarn lint
npx playwright test --config test/browser/playwright.config.js --project=chromium test/browser/tests/block_editing/
```

Compare the two HEADs are equivalent (same tree, different history):

```bash
git diff pre-rewrite-merged-state HEAD     # should be EMPTY
```

If empty, the rewrite is byte-perfect.

---

## Phase 6 — Cut over

When confirmed:

```bash
# Replace the old branch:
git branch -m block-editing-standalone block-editing-standalone-pre-merge-rewrite-2026-04-16
git branch -m block-editing-rewrite block-editing-standalone

# Push (when ready, with explicit confirmation):
# git push --force-with-lease headwayio block-editing-standalone
```

The `pre-rewrite` branch and the `pre-rewrite-merged-state` tag are kept
until you're confident the new branch is good.

---

## Rollback escape hatches

At any point:

| Situation | Recovery |
|---|---|
| Phase 1 merge goes badly | `git merge --abort` |
| Made bad commits in Phase 4 | `git reset --hard origin/main` (discards the rewrite branch's commits but preserves the original branch) |
| Lost track of state | `git checkout backup/pre-merge-rewrite-2026-04-16` (restored to pre-everything state) |
| Rewrite branch is wrong but original is fine | `git checkout block-editing-standalone-pre-merge-rewrite-2026-04-16; git branch -D block-editing-rewrite` |
| The merge tree itself is wrong | `git checkout pre-rewrite-merged-state` to inspect; redo the merge from scratch |

`origin/main` and `headwayio/<anything>` remotes are read-only for this work
unless you explicitly push.

---

## Estimated effort

- **Phase 1 (merge + resolve)**: 60-90 minutes. The hard ones are
  `contents.js` and `editor.js`; the rest are mechanical.
- **Phase 2 (snapshot)**: 5 minutes.
- **Phase 3 (reset)**: 1 minute.
- **Phase 4 (rebuild)**: 45-60 minutes if file copies and commits are
  disciplined. Most of the effort is verifying each commit's diff is
  what's expected before staging.
- **Phase 5 (validate)**: 15 minutes.
- **Phase 6 (cut over)**: 5 minutes once confirmed.

Total: ~3 hours of focused work in a fresh session.

---

## Open questions for the operator

These the new session may want to surface before doing the merge:

1. **Does the audit's XSS finding (1A) need a separate commit?** The merge
   should naturally pull in basecamp's `sanitize(this.innerHtml)` fix,
   ending the regression — no manual commit needed. Confirm by checking
   `src/nodes/custom_action_text_attachment_node.js` after Phase 1 contains
   the `sanitize()` call.

2. **What about Lexical 0.42?** The merge will pull basecamp's
   `package.json` with `^0.42.0`. If Node version or test failures result,
   either upgrade Node or pin Lexical back to 0.41 in a follow-up commit.

3. **Should the topical commits in Phase 4 include the AGENTS.md changes
   from this session?** Check `git diff origin/main..block-editing-standalone -- AGENTS.md`
   — if there are differences, decide whether to include them in the
   topical structure or as a standalone commit.
