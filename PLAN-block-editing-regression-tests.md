# Block-editing regression test plan

> Filled coverage gaps for the `block-editing-standalone` branch so critical
> paths don't silently regress. Generated 2026-04-16 after a session that
> fixed several bugs (wrapped-block outdent, multi-block Turn into, undo
> double-press, scroll jumps, wrapper restrictions, Remove Quote/Bullet,
> Turn-into-list-wraps-non-paragraph). This plan picks up where that work
> stopped.

## How to approach this file

- Each section = one test file or one logical block of tests.
- Priority buckets are ordered: do P1 before P2 before P3.
- Most tests go in `test/browser/tests/block_editing/*.test.js` (Playwright).
- Round-trip tests go in `test/system/*.rb` (Capybara) per AGENTS.md.
- All Playwright tests should use the existing helpers:
  - `../../test_helper.js` for the `test` object with `editor`, `page` fixtures
  - `../../helpers/html.js` → `normalizeHtml`
  - `../../helpers/active_storage_mock.js` → `mockActiveStorageUploads` for
    any test that uploads attachments
  - Shared `assertBlockHtml` / `stripDynamicAttrs` helpers already exist in
    `block_selection.test.js` and `wrapped_block_outdent.test.js` — copy or
    import them.
- Keyboard shortcut constant pattern (already in `block_actions_menu.test.js`):
  ```js
  const modifier = process.platform === "darwin" ? "Meta" : "Control"
  ```
- Rebuild + Rails restart between sessions:
  - `rollup -wc` watch should be running (auto-restarts on src/ changes).
  - If dev skeleton is used (`/Users/jon/Code/lexxy_test_skeleton` on port
    3003), kill and re-start Rails after any src/ change so the asset
    fingerprint refreshes. Playwright tests use `test/dummy/` via Vite on
    5173 — they DO NOT need the skeleton app.

## Current state

79 passing tests as of commit fc4d137f. Gaps enumerated below.

---

## P1 — core capabilities with zero or near-zero coverage

### P1.1 — Origin-aware wrapping (user vs movement)

File: `test/browser/tests/block_editing/wrapped_block_origin.test.js` (new)

Why: commit 070621a2 introduced the two-origin system. Turn-into creates
**user-wrapped** items that persist through arrow movement; Cmd+Shift+↓ into a
list creates **movement-wrapped** items that auto-unwrap on exit. No test
currently locks this contract in.

Tests to add:

1. **User-wrapped stays wrapped across movement**
   ```
   <ul><li>Parent</li></ul><h2>User heading</h2>
   ```
   - Click "User heading", Turn into Bullet list via menu (wraps it).
   - Cmd+Shift+↑ to move it — should nest under "Parent" as a wrapped li.
   - Cmd+Shift+↓ twice to move it back out past the list.
   - Assert: heading still wrapped in a new root-level `<ul>`. Not unwrapped.

2. **Movement-wrapped unwraps on exit**
   ```
   <h2>Drift heading</h2><ul><li>Target</li></ul>
   ```
   - Select the heading in block-select mode, Cmd+Shift+↓ → heading drifts into
     the list (becomes movement-wrapped).
   - Cmd+Shift+↓ again to exit past the list.
   - Assert: heading is now a **standalone** `<h2>` below the list, not a
     wrapped li.

3. **Origin survives depth changes**
   - User-wrapped item: Cmd+Shift+↑ to nest deeper, then Cmd+Shift+↓ many times
     to exit. It should still be wrapped when it pops out.
   - Movement-wrapped item: same journey → unwrapped when it pops out.

4. **Shift+Tab at root unwraps regardless of origin**
   - User-wrapped item at root-level list + Shift+Tab → unwraps.
   - Movement-wrapped item at root-level list + Shift+Tab → unwraps.
   - (Only arrow movement's boundary exit differentiates origins.)

### P1.2 — Attachment-specific block-select tests

File: `test/browser/tests/block_editing/attachment_block_select.test.js` (new)

Needs: `mockActiveStorageUploads(page)` at the start of each test (see
`test/browser/tests/attachments/attachments.test.js` for the pattern).

1. **Turn into Bullet on a standalone attachment wraps it**
   - Upload a PNG, then Escape to block-select, focus the attachment,
     Cmd+/ → Turn into → Bullet list.
   - Assert: attachment is now inside `<ul><li>…</li></ul>`.
   - Editor value contains `action-text-attachment` unchanged (sgid
     preserved).

2. **Shift+Tab on a wrapped attachment at root unwraps to standalone**
   - Set up the wrapped state from test 1, Shift+Tab.
   - Assert: attachment back at root, no surrounding list.

3. **Remove Bullet on a wrapped attachment unwraps to root**
   - Wrapped attachment in a bullet list → menu → Remove Bullet.
   - Assert: attachment at root.

4. **Remove Quote on an attachment wrapped in a blockquote unwraps to root**
   - `<blockquote><action-text-attachment/></blockquote>` → menu → Remove Quote.
   - Assert: attachment at root.

5. **Nested: attachment in blockquote in list, Remove Bullet → root**
   - `<ul><li><blockquote><action-text-attachment/></blockquote></li></ul>`
   - Remove Bullet (or Remove Quote — either should work per commit d9654ab3).
   - Assert: attachment at root, no list, no blockquote.

6. **Cmd+Shift+↓ movement of a wrapped attachment preserves wrapping**
   - Create wrapped attachment next to another block.
   - Cmd+Shift+↓ past the sibling → wrapped attachment in a new list below.

### P1.3 — Single-press undo correctness after Turn into

File: add to `test/browser/tests/block_editing/block_actions_menu.test.js`
(existing file) in a new `test.describe` block, or a separate file.

Why: commit 55632e18 switched HISTORY_MERGE_TAG → HISTORY_PUSH_TAG and tagged
the provisional-paragraph follow-up update with HISTORY_MERGE_TAG. Both
bugs caused "takes two undos" behavior. No test locks this in.

1. **One Cmd+Z after multi-block Turn into Bullet reverts to exactly the
   pre-Turn-into state**
   - Set up `<h2>A</h2><blockquote>B</blockquote><p>After</p>`
   - Select both, Turn into Bullet, Cmd+Z
   - Assert: original HTML (not empty, not partial).

2. **One Cmd+Z after Remove Quote reverts to the blockquote shape**
3. **One Cmd+Z after Remove Bullet reverts to the wrapped-list shape**
4. **One Cmd+Z after multi-block group move reverts to pre-move shape**
   - `<p>A</p><p>B</p><p>C</p>`, select A+B, Cmd+Shift+↓, Cmd+Z → original.

Optional: register an `editor.registerUpdateListener` at the start of each
test to count the history-push commits; assert that each user action
produces exactly one such entry. (See in-session browser diagnostics used
around commit b29532f0 for the technique.)

### P1.4 — Tables as wrappable blocks

File: `test/browser/tests/block_editing/table_block_select.test.js` (new)

Why: fc4d137f narrowed the table skip guard and enabled Turn into Bullet/Quote
on tables. No test.

1. **Turn into Bullet on a standalone table wraps it; cells preserved**
   - `<figure class="lexxy-content__table-wrapper"><table><tbody>…</tbody></table></figure>` with known cells.
   - Focus it, Cmd+/ → Turn into → Bullet list.
   - Assert: `<ul><li><figure>…<table>…</table>…</figure></li></ul>`.
   - Assert: every `<td>` from the original is still present with its content.

2. **Turn into Quote on a standalone table wraps it; cells preserved**

3. **Turn into Text / Heading on a standalone table is a no-op (restriction)**
   - The menu should disable these options (existing test covers the menu
     state). Also assert that if somehow dispatched, the table remains
     intact (regression guard for the skip branch).

4. **Shift+Tab on a wrapped table at root unwraps to standalone table**
   - `<ul><li><figure>…table…</figure></li></ul>` + Shift+Tab
   - Assert: standalone table, cells preserved.

5. **Cmd+Shift+↓ moves a wrapped table past its sibling**

### P1.5 — HR-specific tests

File: add a describe to `test/browser/tests/block_editing/block_actions_menu.test.js`,
or a new `hr_block_select.test.js`.

1. **Turn into Bullet on a standalone `<hr>` wraps it**
   - `<p>Before</p><hr><p>After</p>`, focus HR, Turn into Bullet.
   - Assert: `<ul><li><hr></li></ul>` between the paragraphs.

2. **Cmd+Shift+↓ movement of a wrapped HR**
   - Wrapped HR in a list with siblings; move it down → order updates.

3. **Remove Bullet on a wrapped HR unwraps to root HR**

4. **Arrow-key navigation skips over HR decorator correctly in block-select**
   - Block-select focused above HR, ArrowDown → focus moves to HR.
   - ArrowDown again → focus moves past HR to next block.

---

## P2 — medium priority capabilities

### P2.1 — Inline formatting in block-select multi-block

File: `test/browser/tests/block_editing/inline_format_block_select.test.js` (new)

1. **Cmd+B across a multi-block selection bolds every text node in every
   block**
   - `<p>alpha</p><p>bravo</p>`, select both, Cmd+B
   - Both paragraphs' text is `<strong>` or has `format: 1` internally.

2. **Cmd+I / Cmd+U / Cmd+Shift+X (strikethrough) across multi-block**

3. **Cmd+B on a wrapped heading block applies to the heading text**

4. **Cmd+Shift+H (last-used highlight) across multi-block**
   - Pre-condition: a color has been used recently (seed via localStorage or
     first apply a color via the menu).
   - Then select multi-block and press Cmd+Shift+H → all selected blocks get
     the last color.

### P2.2 — Cmd+A escalation

File: add to `block_api.test.js` or a new `select_all.test.js`

1. **First Cmd+A selects current block's text (edit mode)**
2. **Second consecutive Cmd+A enters block-select with all blocks selected**
3. **Cmd+A while already in block-select selects all blocks**

### P2.3 — Cmd+D duplicates wrapped blocks with children

1. **Cmd+D on a wrapped `<h2>` in a list duplicates the wrapped li**
   - Result: two adjacent `<li><h2>…</h2></li>` items.

2. **Cmd+D on a wrapped li that has a structural-wrapper of children
   duplicates the subtree**
   - `<ul><li><h2>parent</h2></li><li class="nested"><ul><li>child</li></ul></li></ul>`
   - Cmd+D on the parent → new parent with its own children clone.

### P2.4 — Color application on multi-block

File: `test/browser/tests/block_editing/color_block_select.test.js` (new)

1. **Apply a text color via menu across a multi-block selection**
   - All selected blocks' text inherits the color.

2. **Apply a background color (highlight) across multi-block**

3. **Color propagates from parent list item to its selected children** —
   the `#applyOrRestoreParentHighlight` path.

4. **Remove color via the Remove-all-coloring button clears all selected**

5. **Color preserved through Cmd+Shift+↓ movement**

### P2.5 — Mixed-selection Shift+Tab

Add one more test to `wrapped_block_outdent.test.js`:

1. **Shift+Tab on a root list containing plain + wrapped items mixed**
   - `<ul><li>plain</li><li><h2>W</h2></li><li>plain2</li></ul>`
   - Select all three, Shift+Tab
   - Expected: each item lands in the right shape. Wrapped items extract to
     standalone blocks; plain items collect into the naturally-formed list
     segment before/after (per `#extractWrappedItemsInPlace` semantics).

---

## P3 — lower priority / harder to test

### P3.1 — Scroll preservation

File: `test/browser/tests/block_editing/scroll_preservation.test.js` (new)

Pattern: set up a document with ≥40 filler paragraphs above and below the
target block so `scrollY` has room to vary. Scroll to the target, capture
`scrollY`, perform action, assert `scrollY` is within a small delta (±10px
for tolerance).

Actions to cover:
1. Turn into heading (existing scroll-preserving path)
2. Turn into Bullet wrapping a heading
3. Remove Quote
4. Remove Bullet
5. Cmd+Z after any of the above
6. Cmd+Z after multi-block group move
7. Cmd+Shift+↓ when the moved block stays on-screen (no scroll change)

### P3.2 — Block actions menu positioning/anchoring

1. **Menu stays anchored to its block as the page scrolls** — open Cmd+/,
   scroll the page by a small amount, assert menu's computed top/left updated
   to follow its anchor element.
2. **Menu closes on click-outside** — covered by one existing test; add a
   variant with the menu fully open on a submenu.
3. **ArrowDown skips hidden menu items** — Remove Quote hidden, navigation
   from Color should jump to Duplicate (not to Remove Quote). Already fixed
   in commit c47a28ed but not tested.

### P3.3 — Keyboard navigation edge cases

1. **Enter at end of a wrapped heading in block-select mode** — places
   cursor at end of heading in edit mode.
2. **Escape from edit mode inside a wrapped table** — re-enters block-select
   with the table's wrapper li focused.
3. **Arrow keys escaping a wrapped code block** — existing
   `tables_extension.js` registers `COMMAND_PRIORITY_CRITICAL` handlers for
   this; one regression test is worth having.

---

## Capybara round-trip tests (AGENTS.md requirement)

File: `test/system/block_editing_roundtrip_test.rb` (new)

These tests ensure the Action Text save → render → re-edit cycle preserves
the new wrapped-block shapes. Every change to how Lexxy serializes content
on this branch is load-bearing for these.

Pattern (see `test/system/code_highlighting_test.rb` for a reference):
```ruby
test "wrapped heading in bullet list survives the full round-trip" do
  post = Post.create!(body: %q(<ul><li><h2>Wrapped heading</h2></li></ul>))

  visit edit_post_path(post)
  # Assert editor value reflects the wrapped shape
  assert_editor_html %q(<ul><li><h2>Wrapped heading</h2></li></ul>)

  # Submit form (no changes) and reload
  click_on "Update Post"
  visit post_path(post)
  # Assert show page renders the wrapped shape via Action Text
  assert_selector "ul > li > h2", text: "Wrapped heading"

  # Re-edit — assert the editor still loads it wrapped
  visit edit_post_path(post)
  assert_editor_html %q(<ul><li><h2>Wrapped heading</h2></li></ul>)
end
```

Shapes to cover:

1. **Wrapped `<h2>` in `<ul>`**
2. **Wrapped `<blockquote>` in `<ul>`**
3. **Wrapped `<pre data-language="…">` in `<ul>`**
4. **Wrapped `<hr>` in `<ul>`**
5. **Wrapped attachment in `<ul>`** — use `posts(:with_attachment)` fixture
   or seed via `Post.create!` with a pre-uploaded blob.
6. **Blockquote wrapping a decorator** — `<blockquote><hr></blockquote>`
7. **Nested structural wrapper with children** —
   `<ul><li><h2>…</h2></li><li class="lexxy-nested-listitem"><ul><li>child</li></ul></li></ul>`
   — assert the structural-wrapper `<li class="lexxy-nested-listitem">`
   survives.
8. **Wrapped table in list** — `<ul><li><figure><table>…</table></figure></li></ul>`
9. **Movement-wrapped origin does NOT persist** — a heading that was
   movement-wrapped and saved should round-trip as user-wrapped (loaded
   state has no origin marker, fallback is user-wrapped — see
   `#isUserWrapped` comment). Edge-case test; may be skippable if the
   invariant holds by construction.

If any shape fails round-trip, the fix is usually one of:
- `engine.rb` ActionText sanitizer allowlists (tags/attributes)
- `src/config/dom_purify.js` client allowlist
- `app/views/active_storage/blobs/_blob.html.erb` server rendering
- `src/elements/editor.js`'s `#parseHtmlIntoLexicalNodes` for import parity

---

## Suggested execution order

If doing this in one fresh session:

1. P1.1 (origin-aware) — 5 tests, ~1 hour. Pure Playwright, no mocking.
2. P1.3 (undo correctness) — 4 tests, ~45 min. Pure Playwright.
3. P1.4 (tables) — 5 tests, ~1 hour. Pure Playwright.
4. P1.5 (HR) — 4 tests, ~45 min. Pure Playwright.
5. P1.2 (attachments) — 6 tests, ~1.5 hours. Needs
   `mockActiveStorageUploads` + attachment-specific setup.
6. P2.5 (mixed-selection Shift+Tab) — 1 test, 15 min.
7. P2.1 (inline formatting) — 4 tests, ~45 min.
8. P2.2 (Cmd+A escalation) — 3 tests, ~30 min.
9. P2.3 (Cmd+D on wrapped) — 2 tests, ~30 min.
10. P2.4 (color) — 5 tests, ~1 hour.
11. P3.1 (scroll preservation) — 7 tests, ~1.5 hours.
12. P3.2, P3.3 — 30 min each.
13. Round-trip Capybara suite — 9 tests, ~2 hours.

Total: roughly a full day of focused work.

## Success criteria

After this plan is complete:
- `yarn test:browser` passes with all new tests green.
- `bin/rails test:system` passes with the new round-trip tests.
- Total Playwright block-editing suite goes from 79 → ~130+ tests.
- Any commit touching `block_selection_extension.js`, `block_actions_menu.js`,
  `provisional_paragraph_extension.js`, `command_dispatcher.js`, or the
  `nodes/wrapped_table_node.js` gets caught by at least one test if it
  breaks a documented capability.

## Out of scope

- Performance benchmarks (`yarn benchmark:browser`) — tracked separately
  per AGENTS.md.
- Visual regression tests (block highlight CSS, group styling) — needs a
  snapshot tool not currently set up.
- Drag-and-drop tests beyond what exists — 20 tests already cover this
  well; gaps exist but they're lower priority.
