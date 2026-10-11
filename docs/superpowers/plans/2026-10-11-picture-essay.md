# 图文成册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把成品从六张重绘海报改成一篇最多六页的中文图文：原片留在页上，只有一页是画，打开先读这篇，视频按页停 3500 毫秒。

**Architecture:** 服务端把模型结果收成带 `kind` 和 `copy` 的页，并只允许画页调用画图。浏览器用 `site/essay.js` 的纯函数决定版心、停留和导出尺寸，阅读时用 HTML 排字，保存和视频时再合成。旧册没有 `kind` 时整图打开。这一份计划不拆开，因为故事、阅读和导出共用同一种页记录。

**Tech Stack:** Python 3 标准库 `unittest`，现有 `server.py`；浏览器原生模块；`node --test` 跑 `tests/essay.test.mjs`。不加依赖。

**Spec:** `docs/superpowers/specs/2026-10-11-picture-essay.md`

## Global Constraints

- 界面中文。只在本机。不发帖。没有账号、云同步、备份包。
- `ARK_API_KEY` 不到浏览器。不调用 `/api/plan/v3`。
- 看图 `glm-5-3-flash-260828`。画图 `doubao-seedream-5-0-pro-260628`，`size` 仍是 `1536x2560`，`watermark` false，不打开提示词优化。
- 最多 6 页，短名单最多 8 张，单张超过 8 MB 拒绝。
- IndexedDB 库名 `shijing`，对象库名 `posters`。
- 导出页 1080×1440。画面区高度 1008。纸色 `#f3eedf`，字色 `#282923`。
- 正文 `copy` 40 到 70 个字符，恰好两个 `。？！`，以其中之一结尾，无 ASCII 字母，无换行。
- 不合格正文换成规格里的那句整段兜底，不截英文。
- 画页恰好一个；只有一页时没有画页；封面永远是 `cover`。
- 视频每页停留 3500 毫秒。减少动态效果时预览不自动播。
- 不追加「照片里不许有人」。

## Review Focus

- 模型返回英文、39 字或三个句号时，正文必须换成整段兜底，不能把英文截进页面。
- 模型把每一页都标成画，或一页都没标时，仍恰好一页画，且不是封面。
- 旧册只有 `posterId` 和英文 `line` 时要能打开，整图显示，英文不出现在页面上。
- 对照片页调用 `POST /api/poster` 返回 400，服务器上的原片字节不变。
- 朋友圈导出不得再用底部方格裁切，否则文字区会被切掉。

---

### Task 1: 正文长度和画页选择

**Files:**
- Create: `tests/test_essay_story.py`
- Modify: `server.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `FALLBACK_COPY: str`，值等于规格里的整段兜底
  - `fit_copy(text: str, nucleus: str) -> str`
  - `assign_drawing(pages: list[dict]) -> None`，就地写入 `kind`

`fit_copy` 合格则原样返回去掉首尾空白的 `text`。否则返回 `FALLBACK_COPY`。`nucleus` 不参与拼句。

`assign_drawing`：`pages[0]["kind"] = "cover"`。长度为 1 就返回。否则在下标大于 0 且 `draw` 为真的页里，恰好一个时用它，否则用 `max(1, (len(pages) - 1) // 2)`。被选中的页 `kind` 为 `drawing`，其余非封面页为 `photo`。

- [ ] **Step 1: Write the failing test**

```python
import unittest
import server

class FitCopyTest(unittest.TestCase):
    def test_keeps_a_valid_pair(self):
        text = "盘子里只有一点点，手刚从右边离开。那一顿比这张画停得更久，味道一点都没被拍下来。"
        self.assertEqual(server.fit_copy(text, "午饭"), text)

    def test_rejects_english_short_and_three_stops(self):
        fallback = "这一页先停在看见的地方，别的都先不添上去。照片没说完的那一点，先留在这一页里面。"
        self.assertEqual(server.FALLBACK_COPY, fallback)
        for text in ("THE BOAT STAYS.", "太短。也太短。", "一二三。四五六。七八九。十"):
            self.assertEqual(server.fit_copy(text, "核"), fallback)

class AssignDrawingTest(unittest.TestCase):
    def test_one_page_has_no_drawing(self):
        pages = [{"draw": True}]
        server.assign_drawing(pages)
        self.assertEqual(pages[0]["kind"], "cover")

    def test_many_flags_use_the_middle_body_page(self):
        pages = [{"draw": True}, {"draw": True}, {"draw": True}, {"draw": True}]
        server.assign_drawing(pages)
        self.assertEqual([page["kind"] for page in pages], ["cover", "drawing", "photo", "photo"])

    def test_one_flag_wins(self):
        pages = [{}, {"draw": False}, {"draw": True}]
        server.assign_drawing(pages)
        self.assertEqual([page["kind"] for page in pages], ["cover", "photo", "drawing"])
```

四页时 `(4 - 1) // 2` 是 1，所以画在第二页。这是规格公式，不要改成「视觉上的中间」。

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_essay_story -v`

Expected: FAIL，`fit_copy` 或 `assign_drawing` 不存在

- [ ] **Step 3: Implement `fit_copy` and `assign_drawing` in `server.py`**

放在 `english_line` 旁边。`english_line` 先留着，Task 2 再停止使用。

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_essay_story.py server.py
git commit -m "feat: validate essay copy and pick one drawing page"
```

### Task 2: 故事结果收成页

**Files:**
- Modify: `tests/test_essay_story.py`
- Modify: `server.py`（`build_story`）

**Interfaces:**
- Consumes: `fit_copy`，`assign_drawing`
- Produces: `normalize_story(result: dict, photos: list[dict], sentence: str) -> dict`

返回：

```python
{
    "title": str,       # 最长 24，空则 "一趟旅行"
    "sentence": str,    # 最长 80
    "pages": [
        {
            "photoId": str,
            "nucleus": str,          # 最长 80
            "anchors": list[str],    # 最多 3 个，每个最长 40
            "discard": str,          # 最长 160
            "copy": str,
            "kind": str,             # cover | photo | drawing
        }
    ],
}
```

封面 `copy` 是 `sentence` 去掉首尾空白后的前 80 字，不经过 `fit_copy`。正文 `copy` 用 `fit_copy`。未知或重复的 `photoId` 丢掉。一页都没有时，用 `photos[0]` 做唯一封面。`build_story` 改为调用它，提示词向模型要 `copy` 和 `draw`，不再要英文 `line`。

- [ ] **Step 1: Write the failing test**

```python
class NormalizeStoryTest(unittest.TestCase):
    def test_cover_keeps_short_sentence_and_one_drawing(self):
        photos = [
            {"id": "a", "reading": {"nucleus": "雪", "anchors": ["山"], "discard": "塔"}},
            {"id": "b", "reading": {"nucleus": "路", "anchors": ["雾"], "discard": ""}},
        ]
        raw = {
            "title": "雪后",
            "pages": [
                {"photoId": "b", "copy": "路还在雾里，两边的树只剩一层浅色。我们没有再往前走，照片把这段空空地停在了这里。", "draw": False},
                {"photoId": "a", "copy": "not chinese", "draw": True},
                {"photoId": "missing", "copy": "路还在雾里，两边的树只剩一层浅色。我们没有再往前走，照片把这段空空地停在了这里。"},
            ],
        }
        story = server.normalize_story(raw, photos, "雪停在远处，这一趟就从这里看过去。")
        self.assertEqual(story["title"], "雪后")
        self.assertEqual(story["pages"][0]["kind"], "cover")
        self.assertEqual(story["pages"][0]["copy"], "雪停在远处，这一趟就从这里看过去。")
        self.assertEqual(story["pages"][0]["photoId"], "b")
        self.assertEqual(story["pages"][1]["kind"], "drawing")
        self.assertEqual(story["pages"][1]["copy"], server.FALLBACK_COPY)
        self.assertNotIn("line", story["pages"][0])

    def test_empty_model_result_is_one_cover(self):
        photos = [{"id": "a", "reading": {"nucleus": "雪", "anchors": ["山"], "discard": ""}}]
        story = server.normalize_story({"pages": []}, photos, "")
        self.assertEqual(len(story["pages"]), 1)
        self.assertEqual(story["pages"][0]["kind"], "cover")
        self.assertEqual(story["pages"][0]["photoId"], "a")
        self.assertEqual(story["pages"][0]["copy"], "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_essay_story.NormalizeStoryTest -v`

Expected: FAIL，`normalize_story` 不存在

- [ ] **Step 3: Implement `normalize_story` and point `build_story` at it**

提示词里的 JSON 样例是 `{"title":"中文书名","pages":[{"photoId":"","copy":"","draw":false}]}`。写明正文两句、40 到 70 字、只有一页 `draw` 为 true，且第一页不要画。不要再提到 `THE BOAT STAYS.`

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_essay_story.py server.py
git commit -m "feat: return Chinese essay pages from the story step"
```

### Task 3: 只画那一页，图内无字

**Files:**
- Modify: `tests/test_essay_story.py`
- Modify: `server.py`（`poster_prompt`、`draw_poster`、`POST /api/poster`、新增 `POST /api/drawing`）

**Interfaces:**
- Consumes: 页上的 `kind`、`nucleus`、`anchors`、`discard`
- Produces:
  - `drawing_prompt(page: dict) -> str`
  - `poster_error(page: dict) -> str | None`
  - `set_drawing(session: dict, index: int) -> dict`
  - `POST /api/drawing`，体 `{ "session", "index" }`，返回更新后的 story
  - `POST /api/poster` 在 `kind != "drawing"` 时 400，体 `{"error":"这一页不用画"}`

`drawing_prompt` 必须包含这一页的 nucleus、每个锚点、`Fill the frame`、`No text`。不得包含 `Top 60%`、`No people`、页的 `copy`。`draw_poster` 改用 `drawing_prompt`。尺寸、模型和 `watermark` 不改。

`set_drawing`：`index <= 0` 或越界时抛 `RuntimeError("封面不能改成画")`。页数小于 2 时抛 `RuntimeError("这一页不用画")`。成功后种类重新分配，返回 `session["story"]`。

- [ ] **Step 1: Write the failing test**

```python
class DrawingPromptTest(unittest.TestCase):
    def test_prompt_fills_the_frame_and_has_no_caption(self):
        page = {
            "nucleus": "一盘午饭",
            "anchors": ["白盘", "右手"],
            "discard": "酒杯",
            "copy": "盘子里只有一点点，手刚从右边离开。那一顿比这张画停得更久，味道一点都没被拍下来。",
        }
        prompt = server.drawing_prompt(page)
        self.assertIn("一盘午饭", prompt)
        self.assertIn("白盘", prompt)
        self.assertIn("Fill the frame", prompt)
        self.assertIn("No text", prompt)
        self.assertNotIn("Top 60%", prompt)
        self.assertNotIn("No people", prompt)
        self.assertNotIn(page["copy"], prompt)

class SetDrawingTest(unittest.TestCase):
    def test_cover_cannot_become_the_drawing(self):
        session = {"story": {"pages": [{"kind": "cover"}, {"kind": "drawing"}]}}
        with self.assertRaisesRegex(RuntimeError, "封面不能改成画"):
            server.set_drawing(session, 0)

    def test_moves_the_single_drawing(self):
        session = {"story": {"pages": [
            {"kind": "cover"}, {"kind": "drawing"}, {"kind": "photo"},
        ]}}
        story = server.set_drawing(session, 2)
        self.assertEqual([page["kind"] for page in story["pages"]], ["cover", "photo", "drawing"])

class PosterGuardTest(unittest.TestCase):
    def test_photo_page_is_refused(self):
        self.assertEqual(server.poster_error({"kind": "photo"}), "这一页不用画")
        self.assertEqual(server.poster_error({"kind": "cover"}), "这一页不用画")
        self.assertIsNone(server.poster_error({"kind": "drawing"}))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_essay_story.DrawingPromptTest tests.test_essay_story.SetDrawingTest tests.test_essay_story.PosterGuardTest -v`

Expected: FAIL

- [ ] **Step 3: Implement the prompt, `set_drawing`, and both routes**

`poster_error` 在 `kind != "drawing"` 时返回 `"这一页不用画"`，否则返回 `None`。`POST /api/poster` 先调用它，有错误就 `end_json(400, {"error": 那句})`，不要进 `draw_poster`。成功时返回 `url`、`copy`、`kind`、`title`，不再返回 `line`。

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_essay_story.py server.py
git commit -m "feat: draw only one illustration and keep text out of it"
```

### Task 4: 浏览器里的版心和页种类

**Files:**
- Create: `site/essay.js`
- Create: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export const FRAME = { width: 1080, height: 1440, imageHeight: 1008 }`
  - `export const HOLD_MS = 3500`
  - `export function coverSize(srcW, srcH, longEdge = 1500)`
  - `export function moveDrawing(pages, index)`
  - `export function isLegacy(page)`
  - `export function essayMarkup(page)`

`coverSize` 保持长宽比，长边不超过 1500。1080×1440 得到 1125×1500。

`moveDrawing` 不改入参，返回新数组。`index <= 0`、越界或页数小于 2 时返回拷贝。否则第 0 页 `cover`，目标页 `drawing`，其余 `photo`。

`isLegacy` 在 `kind` 缺失或为 `"legacy"` 时为真。

`essayMarkup` 返回 HTML 字符串。`legacy` 只有一张图，类名 `essay-legacy`，字符串里不出现 `page.line`。封面文字区有 `page.title` 和 `page.sentence`（句子空则不要空段落）。正文和画页的文字区是 `page.copy`。图的地址是 `page.url`。

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import { FRAME, HOLD_MS, coverSize, moveDrawing, isLegacy, essayMarkup } from "../site/essay.js";

test("frame and hold", () => {
  assert.deepEqual(FRAME, { width: 1080, height: 1440, imageHeight: 1008 });
  assert.equal(HOLD_MS, 3500);
  assert.deepEqual(coverSize(1080, 1440), { width: 1125, height: 1500 });
});

test("moveDrawing never takes the cover", () => {
  const pages = [{ kind: "cover" }, { kind: "drawing" }, { kind: "photo" }];
  assert.deepEqual(moveDrawing(pages, 0).map((page) => page.kind), ["cover", "drawing", "photo"]);
  assert.deepEqual(moveDrawing(pages, 2).map((page) => page.kind), ["cover", "photo", "drawing"]);
});

test("legacy markup hides the English line", () => {
  const html = essayMarkup({
    url: "old.png",
    kind: "legacy",
    line: "THE BOAT STAYS.",
    copy: "",
  });
  assert.equal(isLegacy({ posterId: "x", line: "THE BOAT STAYS." }), true);
  assert.match(html, /essay-legacy/);
  assert.equal(html.includes("THE BOAT STAYS."), false);
});

test("cover markup has the title and sentence, and no empty sentence", () => {
  const html = essayMarkup({
    url: "cover.jpg",
    kind: "cover",
    title: "试册",
    sentence: "雪停在远处，这一趟就从这里看过去。",
    copy: "雪停在远处，这一趟就从这里看过去。",
  });
  assert.match(html, /试册/);
  assert.match(html, /雪停在远处/);
  const quiet = essayMarkup({ url: "cover.jpg", kind: "cover", title: "试册", sentence: "", copy: "" });
  assert.match(quiet, /试册/);
  assert.equal(quiet.includes("雪停在远处"), false);
  assert.equal(quiet.includes("<p></p>"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL，找不到 `site/essay.js`

- [ ] **Step 3: Implement `site/essay.js`**

这个文件不访问 `document`、`window` 或画布。转义 `& < > " '`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/essay.js tests/essay.test.mjs
git commit -m "feat: define the essay frame and page markup"
```

### Task 5: 试册改成四页图文

**Files:**
- Create: `site/assets/sample/photos/terraces.jpg`
- Create: `site/assets/sample/photos/fog-road.jpg`
- Create: `site/assets/sample/photos/alley.jpg`
- Modify: `site/app.js`（`SAMPLE`）
- Modify: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: `essayMarkup`
- Produces: `export const sampleBook`，形状 `{ id: "sample", title: "试册", sentence: "雪停在远处，这一趟就从这里看过去。", created: 0, sample: true, pages: [...] }`

`site/app.js` 用 `import { sampleBook as SAMPLE } from "./essay.js"`，不要在 `app.js` 里再写一份页。每页有 `url`、`kind`、`copy`。封面 `copy` 等于 `sentence`。文字和路径用规格表，逐字复制。画页继续用现成的 `assets/sample/03.png`。

- [ ] **Step 1: Write the failing test**

```javascript
test("sample book is the four-page essay", () => {
  assert.equal(sampleBook.pages.map((page) => page.kind).join(","), "cover,photo,drawing,photo");
  assert.equal(sampleBook.sentence.length, 17);
  assert.deepEqual(sampleBook.pages.map((page) => page.copy.length), [17, 40, 40, 40]);
  assert.equal(sampleBook.pages[2].url, "assets/sample/03.png");
  assert.equal(sampleBook.pages[0].url, "assets/sample/photos/terraces.jpg");
});
```

测试从 `site/essay.js` 导入 `sampleBook`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL

- [ ] **Step 3: Copy the three source photos and replace `SAMPLE`**

```bash
mkdir -p site/assets/sample/photos
cp demo-distill/sources/terraces.jpg demo-distill/sources/fog-road.jpg demo-distill/sources/alley.jpg site/assets/sample/photos/
```

`meal.jpg` 不复制。`site/app.js` 的 `SAMPLE.pages` 不再使用 `01.png`、`02.png`、`04.png`，也不再放英文 `line`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/assets/sample/photos site/app.js tests/essay.test.mjs
git commit -m "feat: replace the sample book with a four-page essay"
```

### Task 6: 打开先读图文

**Files:**
- Modify: `site/app.js`（`showReading`，约 239 行）
- Modify: `site/style.css`
- Modify: `site/handoff.js`（`mountHandoff` 的默认画面）

**Interfaces:**
- Consumes: `essayMarkup`，`HOLD_MS`，`isLegacy`
- Produces: 阅读页结构。`#essay` 在前，`#handoff` 在后。没有「翻册」，不再调用 `mountBook`。

`showReading` 的提示是「先读这篇」。左右按钮和点按左右半边换页。到头的按钮禁用。`prefers-reduced-motion: reduce` 时视频预览不调用现在的 `startReel`。

`mountHandoff` 打开时不要把三种形式当成整页。宿主放在文末，上面有一行「发出去」。三个名字仍是朋友圈、小红书、视频。`保存原图` 改成 `保存画面`，这一步先只改名字，合成留到 Task 9。

`reader.js` 先留在磁盘，不要删。

- [ ] **Step 1: Write the failing test**

给 `essay.js` 增加 `export function readingShell()`，返回的字符串按顺序包含 `id="essay"`、`发出去`、`id="handoff"`，并且不包含 `翻册`。测试断言这个顺序。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL

- [ ] **Step 3: Implement the shell and mount it from `showReading`**

画面区高度用 `FRAME.imageHeight / FRAME.height`。文字区在图下面，字号 22，行高 1.55，颜色用现成的 `--ink` 和 `--paper`。旧页用 `essay-legacy`，图 `object-fit: contain`，不要文字区。不要改 `.cover` 的 `aspect-ratio: 3 / 5`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/essay.js site/app.js site/style.css site/handoff.js tests/essay.test.mjs
git commit -m "feat: open a book on the essay"
```

### Task 7: 故事确认页就是草稿

**Files:**
- Modify: `site/app.js`（`confirmSentence`、`confirmStory`）
- Modify: `site/essay.js`
- Modify: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: `moveDrawing`，`essayMarkup`，`POST /api/drawing`
- Produces: `export function draftMarkup(story, photosById)`

`photosById` 是 `Map`，键是 `photoId`，值是 `{ url }`。`draftMarkup` 对每一页输出图和 `copy`。非封面页有按钮，`data-draw` 等于页下标，文字是「改成画」。主按钮文字是「就按这个做」。不输出英文 `line`。

`confirmStory(token, session, story, back, chosen)` 增加 `chosen`。缩略图来自 `chosen.kept`，用 `photoId` 对上 `URL.createObjectURL`。点「改成画」调用 `POST /api/drawing`，用返回的 story 重画草稿。点「就按这个做」才进入制作。勾选那一屏仍不放照片。

- [ ] **Step 1: Write the failing test**

```javascript
test("draft shows the photo and a drawing control", () => {
  const html = draftMarkup({
    title: "雪后",
    sentence: "雪停在远处，这一趟就从这里看过去。",
    pages: [
      { photoId: "a", kind: "cover", copy: "雪停在远处，这一趟就从这里看过去。" },
      { photoId: "b", kind: "drawing", copy: "路还在雾里，两边的树只剩一层浅色。我们没有再往前走，照片把这段空空地停在了这里。" },
    ],
  }, new Map([["a", { url: "a.jpg" }], ["b", { url: "b.jpg" }]]));
  assert.match(html, /就按这个做/);
  assert.match(html, /data-draw="1"/);
  assert.equal(html.includes("data-draw=\"0\""), false);
  assert.equal(html.includes("THE "), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL

- [ ] **Step 3: Implement `draftMarkup` and use it in `confirmStory`**

把 `chosen` 从 `confirmSentence` 传进去。对象 URL 在离开这一屏时撤销。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/essay.js site/app.js tests/essay.test.mjs
git commit -m "feat: confirm the story on the essay draft"
```

### Task 8: 只等一幅画，旧册仍能打开

**Files:**
- Modify: `site/app.js`（`readAlbum`、`saveAlbum`、`drawBook`）
- Modify: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: 页的 `photoId`、`kind`、`copy`；`chosen.kept[].id` 和 `.blob`
- Produces:
  - `export function pagesToStore(storyPages, ids)`
  - `export function skipDrawing(pages, index)`

`pagesToStore` 返回 `{ posterId, kind, copy }` 的数组，不包含 `line`。`ids.length` 必须等于页数。调用方用 `crypto.randomUUID()` 生成这些 id。

`skipDrawing` 返回新数组。目标页是 `drawing` 时改成 `photo`，其余页不动。目标页不是画，或下标越界时，返回拷贝。

`readAlbum`：记录有 `kind` 就用它；没有则 `kind: "legacy"`，`copy: ""`。blob 仍从 `posters` 用 `posterId` 读取。

`drawBook`：照片页和封面不请求 `/api/poster`，blob 用 `chosen.kept` 里同一个 id 的 JPEG。只有 `drawing` 显示「正在画这一页」。失败时按钮仍是「再画这一页」和「跳过这一页」。跳过调用 `skipDrawing` 并使用原片，不中断其余页。一页原片都没有时才不放上书架。

- [ ] **Step 1: Write the failing test**

从 `site/essay.js` 把 `pagesToStore` 和 `skipDrawing` 加进测试文件的 import。

```javascript
test("stored pages keep kind and copy without the English line", () => {
  const stored = pagesToStore([
    { kind: "cover", copy: "一句。" },
    { kind: "drawing", copy: "两句。停在这里。" },
  ], ["id-1", "id-2"]);
  assert.deepEqual(stored, [
    { posterId: "id-1", kind: "cover", copy: "一句。" },
    { posterId: "id-2", kind: "drawing", copy: "两句。停在这里。" },
  ]);
});

test("skipping the drawing keeps that page as a photo", () => {
  const pages = [{ kind: "cover" }, { kind: "drawing" }, { kind: "photo" }];
  assert.deepEqual(skipDrawing(pages, 1).map((page) => page.kind), ["cover", "photo", "photo"]);
  assert.deepEqual(skipDrawing(pages, 0).map((page) => page.kind), ["cover", "drawing", "photo"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL

- [ ] **Step 3: Implement storage and the one-drawing wait**

`saveAlbum` 仍把 blob 写进 `posters`，键是 `posterId`。不要新建对象库。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/essay.js site/app.js tests/essay.test.mjs
git commit -m "feat: save essay pages and keep old albums readable"
```

### Task 9: 三个出口都用整页

**Files:**
- Modify: `site/handoff.js`
- Modify: `site/essay.js`
- Modify: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: `FRAME`，`HOLD_MS`，`coverSize`
- Produces:
  - `export function exportSize(name)`
  - `recordReel` 使用的停留改为 `HOLD_MS / 1000` 秒

`exportSize("cover")` 返回 `{ width: 1125, height: 1500 }`。`exportSize("page")` 返回 `{ width: 1080, height: 1440 }`。朋友圈封面用 `cover`，朋友圈其余页、小红书、保存画面、视频都用 `page`。不要再为这些出口调用 `frameRect` 做底部方格。

视频画布是 1080×1440，不是 720×1280。每页先完整停留 3.5 秒。现有的 0.45 秒淡出可以留在停留之后。预览间隔改成 `HOLD_MS`。

合成时：非 legacy 页把图铺满上 1008 像素（`cover` 裁切），文字区填 `#f3eedf` 并画上 `copy` 或封面的书名和句子。legacy 页整图放进 1080×1440，不另画英文。

- [ ] **Step 1: Write the failing test**

```javascript
test("exports keep the whole 3:4 page", () => {
  assert.deepEqual(exportSize("cover"), { width: 1125, height: 1500 });
  assert.deepEqual(exportSize("page"), { width: 1080, height: 1440 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL

- [ ] **Step 3: Implement export sizes and the reel hold**

朋友圈界面不再出现方格裁切的说明文字。封面按钮保存那一张 1125×1500，其余按钮保存后面的 1080×1440。`handoff.js` 里现成的 `coverSize` 删掉，改从 `essay.js` 导入。`captionOf` 仍用已确认的句子，没有句子时用书名，不要改这条。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs && python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/essay.js site/handoff.js tests/essay.test.mjs
git commit -m "feat: export the essay frames without cropping off the text"
```

### Task 10: 说明和试册走查

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 前面各任务的页面和接口
- Produces: 一份和现站一致的中文说明

- [ ] **Step 1: Update `README.md`**

改掉这些说法：成品全是海报、英文短句画进图里、确认时还没有画册、打开先看见三个名字、「翻册」、「保存原图」、试册四句英文、`POST /api/poster` 逐页都画。

写上：故事确认能看见分到各页的原片；点头后只画一页；`POST /api/drawing` 改画页；照片页不会画；打开先读图文；视频每页约 3.5 秒；试册四页的中文按规格。`demo-distill/` 写成旧试验，不是现在的试册。

- [ ] **Step 2: Run the automated tests**

Run: `python3 -m unittest tests.test_essay_story -v && node --test tests/essay.test.mjs`

Expected: PASS

- [ ] **Step 3: Check the sample book in the browser**

`python3 server.py` 后打开 `http://127.0.0.1:8765`。打开试册。先看见四页图文，不是三个出口名字。封面是富士山那张原片和那句 17 字的中文。第二页、第四页是原片。第三页是盘子那幅画。左右能换页，到头的按钮不能再翻。文末再点朋友圈、小红书和视频。视频预览每页停得够读完两句。不要求这次真的丢一套新照片去调画图接口。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the essay instead of the poster book"
```
