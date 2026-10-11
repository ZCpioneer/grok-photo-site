# 借光 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the beige desk chrome with 借光, so the room around a 拾景 page takes its color from that page's photograph and the page is the only bright object.

**Architecture:** Pure color math lives in `site/light.js`. `site/style.css` restyles every existing screen with the same tokens. `app.js` samples a photo's top edge, writes `--room` / `--on-room`, and keeps the essay as the large page while 发出去 opens a dock beside it. Export bytes stay 3:4 pages; the screen paper moves to `#f2f0ea` and the cover title no longer tracks, so the saved file matches the page.

**Tech Stack:** Vanilla ES modules, CSS custom properties, Canvas for the edge sample. No new dependencies.

**Spec:** Claude Code preview at `/tmp/shijing-redesign/preview/index.html` (direction name 借光). Product rules that stay: `docs/superpowers/specs/2026-10-11-picture-essay.md` and `docs/superpowers/specs/2026-10-11-essay-revisions.md`, except screen/export paper `#f2f0ea` and cover tracking `0` (this plan's call, so the file matches the new page).

## Global Constraints

- Chinese UI copy already on the screens stays. Do not add a slogan.
- At most one drawing, never the cover. Photos stay photographs. No photo wall on the sentence screen.
- Page ratio stays 1080×1440. Image band stays 1008. Portrait photos stay contained; landscape and square stay covered.
- `readingShell()` still contains `id="essay"`, then `发出去`, then `id="handoff"`, and never `翻册`.
- `.essay-frame` rule stays a single line with `aspect-ratio: 1080 / 1440` and no `overflow`. `.essay-copy` stays a single line with no `overflow`. `.draft-bar` stays `position: sticky`.
- Handoff still has one 「保存这一套」 for 朋友圈 and 小红书, and 「保存视频」 for video. No 「保存画面」.
- `prefers-reduced-motion: reduce` sets the room fade to 0 and does not autoplay the video preview.

## Review Focus

- A portrait photo on a shelf cell and on a page must letterbox on paper, not crop.
- Opening 朋友圈, 小红书, or 视频 must not hide the save button or change the exported pixel size.
- Sampling a cross-origin or broken image must leave the room on the undeveloped color `#3e3f3c`.
- Reaching the last page, then going back, keeps 发出去 fully visible.
- Dropping files on 「做一本」 must start the same make flow as choosing files inside 做一本.

---

### Task 1: Room color

**Files:**
- Create: `site/light.js`
- Test: `tests/light.test.mjs`

**Interfaces:**
- Produces: `roomHexFromPixels(rgba: Uint8ClampedArray, options?: { drawing?: boolean }) -> string`, `onRoom(hex: string) -> "#282923" | "#f2f0ea"`, `labFromPixels(rgba) -> [number, number, number]`, `mixRooms(labs: number[][]) -> { trip: string, room: string }`, `UNDEVELOPED = "#3e3f3c"`.

- [x] **Step 1: Write the failing test** for a flat white field (drawing stays light, photo is muted), a flat black field (dark), and `onRoom`.

- [x] **Step 2: Run** `node --test tests/light.test.mjs` and confirm fail.

- [x] **Step 3: Implement** the preview's sRGB → Oklab path. Photo rooms clamp L into 0.36–0.50 and chroma to at most 0.055. Drawing rooms keep the average. Top 8% is the caller's job: this function only averages the pixels it is given.

- [x] **Step 4: Run the test** and confirm pass.

- [x] **Step 5: Commit** `feat: borrow a room color from pixels`

### Task 2: Chrome

**Files:**
- Modify: `site/style.css`, `site/index.html`, `site/essay.js` (`readingShell` only), `site/handoff.js` (paper `#f2f0ea`, cover tracking 0, `onMode` / `onFrame` / `show`)
- Modify: `site/app.js` (scene class, shelf spine, drop light, reading hover and swipe, dock sync)
- Test: existing `tests/essay.test.mjs`, `tests/handoff.test.mjs`

- [x] **Step 1: Run** `node --test tests/essay.test.mjs tests/handoff.test.mjs tests/light.test.mjs` and confirm the current suite passes before the restyle.

- [x] **Step 2: Restyle.** Desk becomes `--room`. Header loses its rule. Shelf is a horizontal row with a vertical 「做一本」 spine. Drop zone is a page-shaped void. Reading page is centered; 上一页 / 下一页 appear only beside the hovered half; 发出去 sits under the page and stays dim until the last page has been reached. An open format docks its save controls to the right of the page. Video preview plays in the page frame.

- [x] **Step 3: Wire light.** Shelf hover, the current essay page, and the running average of a drop each call `applyRoom`. A failed sample does not throw.

- [x] **Step 4: Re-run the three test files.** Expected: all pass.

- [x] **Step 5: Commit** `feat: restyle 拾景 as borrowed light`

### Task 3: Look at it

- [x] Open `http://127.0.0.1:8765/#/`, `#/make`, and `#/read/sample` in a headless 1440×900 and 390×844 screenshot. Turn a page, open 小红书, and confirm the room color changes and the save control is visible.
