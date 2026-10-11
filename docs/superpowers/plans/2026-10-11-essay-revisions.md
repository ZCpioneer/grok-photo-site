# 图文修订 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作者能改草稿里的字、能放下那一幅画，并让阅读、裁切和视频按修订后的版式工作。

**Architecture:** 服务端继续收成带 `kind` 和 `copy` 的页，并新增改字和取消画页两个入口。浏览器把停留、裁切、折行和草稿文案收成 `site/essay.js` 的纯函数，`app.js` 只负责把这些函数接到现有的制作流程上，`handoff.js` 在保存和预览时调用同一套函数。IndexedDB 的页记录不改。

**Tech Stack:** Python 3 标准库 `unittest`，现有 `server.py`；浏览器原生模块；`node --test` 跑 `tests/essay.test.mjs` 和 `tests/handoff.test.mjs`。不加依赖。

**Spec:** `docs/superpowers/specs/2026-10-11-essay-revisions.md`

## Global Constraints

- 界面中文。只在本机。不发帖。没有账号、云同步、备份包。
- `ARK_API_KEY` 不到浏览器。不调用 `/api/plan/v3`。
- 看图 `glm-5-3-flash-260828`。画图 `doubao-seedream-5-0-pro-260628`，`size` 仍是 `1536x2560`，`watermark` false，不打开提示词优化。
- 最多 6 页，短名单最多 8 张，单张超过 8 MB 拒绝。
- IndexedDB 库名 `shijing`，对象库名 `posters`。页记录仍是 `{ posterId, kind, copy }`。
- 导出页 1080×1440。画面区高度 1008。纸色 `#f3eedf`，正文字色 `#282923`。
- 模型正文仍由 `fit_copy` 限制在 40 到 70 字；不合格仍换成整段兜底，不截英文。
- 封面不能是画。对照片页调用 `POST /api/poster` 仍返回 400「这一页不用画」。
- 旧册没有 `kind` 时整图打开，不显示原来的英文。
- 朋友圈封面 1125×1500，其余页和小红书 1080×1440。不裁方格。
- 减少动态效果时视频预览不自动播。保存的视频仍按时间轴走。

## Review Focus

- 作者把正文改成一句、写进 ASCII，或超过 80 字时，接口拒绝，服务器上原来的正文还在。
- 作者取消画页之后，每一页都不是 `drawing`，再请求画图会被拒绝；草稿仍能只靠原片放上书架。
- 竖图整张落在 1008 高的画面区里；横图和方图仍铺满这块区域。
- 导出折行时，`。，！？、` 不出现在一行的开头，除非它前面没有别的行。
- 从草稿回到一句话那一屏时，改过的句子、勾过的项和补上的一句都还在。

---

### Task 1: 故事规则

**Files:**
- Modify: `server.py`（`assign_drawing`、`build_story`）
- Test: `tests/test_essay_story.py`

**Interfaces:**
- Consumes: 现有的 `assign_drawing(pages)`、`build_story(session, answers, note)`。
- Produces:
  - `NONE_TEXT = "这几件都没发生"`
  - `none_check() -> dict`，值为 `{"id": "none", "text": NONE_TEXT}`
  - `STORY_RULES: str`，内容就是规格「作者的字」和「画」里给模型的那几句，外加顺序和字数：第一句只写看得见的；第二句只写照片里没有的声音、气味、温度或画框外面，不写人做了什么；人做了什么只有用户补的那一句里写过才能写；正文两句、40 到 70 字、恰好两个句末符号；`draw` 可以没有，至多一页；第一页不要画。字符串里不出现「纸刊」，也不出现「只有一页 draw 为 true」。
  - `story_prompt(session: dict, kept: list[str], rejected: list[str], note: str) -> str`。`build_story` 把这段交给 `chat`，不再自己拼提示。

- [ ] **Step 1: Write the failing test**

在 `AssignDrawingTest` 里加 `test_no_flag_leaves_every_body_page_a_photo`：三页都没有 `draw` 时，`kind` 依次是 `cover`、`photo`、`photo`。已有的「多个标记取中间页」「恰好一个标记」「只有一页」三个测试保持不变。

加 `StoryPromptTest`：

```python
def test_rules_keep_the_second_sentence_off_the_photo(self):
    self.assertIn("第二句只写照片里没有的", server.STORY_RULES)
    self.assertIn("至多一页", server.STORY_RULES)
    self.assertNotIn("纸刊", server.STORY_RULES)
    self.assertNotIn("只有一页 draw 为 true", server.STORY_RULES)
    session = {"sentence": "雪停在远处。", "photos": []}
    prompt = server.story_prompt(session, [], [], "雾很冷")
    self.assertIn(server.STORY_RULES, prompt)
    self.assertIn("雪停在远处。", prompt)
    self.assertIn("雾很冷", prompt)
    self.assertIn("没有额外情节", prompt)

def test_none_check_names_the_events(self):
    self.assertEqual(server.none_check(), {"id": "none", "text": "这几件都没发生"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_essay_story.AssignDrawingTest.test_no_flag_leaves_every_body_page_a_photo tests.test_essay_story.StoryPromptTest -v`

Expected: FAIL，`story_prompt` 或新测试不存在。

- [ ] **Step 3: Implement the rules in `server.py`**

`assign_drawing`：零个正文标记时不选画页；一个标记用那一页；多于一个时用现在的中间页。`build_sentence` 改成追加 `none_check()`。`build_story` 调用 `story_prompt`。页数上限、JSON 形状、认下的情节和否定的情节仍由 `story_prompt` 写上，空的认下情节写「没有额外情节」。

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.py tests/test_essay_story.py
git commit -m "feat: let a story omit the drawing"
```

### Task 2: 作者改字和取消画页

**Files:**
- Modify: `server.py`（`Handler.do_POST`）
- Test: `tests/test_essay_story.py`

**Interfaces:**
- Consumes: `author` 规则见规格。`_ENDERS` 仍是 `。？！`。
- Produces:
  - `author_sentence(text: str) -> str`
  - `author_copy(text: str) -> str`
  - `take_sentence(session: dict, payload: dict) -> None`。只有 payload 里有 `sentence` 这个键时才改 `session["sentence"]`。
  - `set_copy(session: dict, index: int, copy: str) -> dict`。返回 `session["story"]`。下标 0 同时改 `pages[0]["copy"]`、`story["sentence"]` 和 `session["sentence"]`。
  - `clear_drawing(session: dict) -> dict`。封面仍是 `cover`，其余页是 `photo`。
  - `POST /api/story` 在调用 `build_story` 之前调用 `take_sentence`。
  - `POST /api/copy` 调用 `set_copy`。
  - `POST /api/drawing` 在 `clear` 为真时调用 `clear_drawing`，否则仍调用 `set_drawing`。

- [ ] **Step 1: Write the failing test**

```python
class AuthorCopyTest(unittest.TestCase):
    def test_cover_sentence_can_be_empty_and_rejects_ascii(self):
        self.assertEqual(server.author_sentence("  雪停在远处。  "), "雪停在远处。")
        self.assertEqual(server.author_sentence(""), "")
        self.assertEqual(len(server.author_sentence("句" * 80)), 80)
        with self.assertRaisesRegex(RuntimeError, "这句话先改成中文，80 字以内"):
            server.author_sentence("句" * 81)
        with self.assertRaisesRegex(RuntimeError, "这句话先改成中文，80 字以内"):
            server.author_sentence("Snow。")
        with self.assertRaisesRegex(RuntimeError, "这句话先改成中文，80 字以内"):
            server.author_sentence("雪。\n")

    def test_body_can_be_short_and_rejects_one_sentence(self):
        self.assertEqual(server.author_copy("雾。冷。"), "雾。冷。")
        eighty = "测" * 77 + "。完。"
        self.assertEqual(len(eighty), 80)
        self.assertEqual(server.author_copy(eighty), eighty)
        for text in ("只有一句。", "路。A。", "测" * 78 + "。完。", "雾。冷。啊", "雾。\n冷。"):
            with self.assertRaisesRegex(RuntimeError, "这一页要正好两句，80 字以内"):
                server.author_copy(text)

    def test_set_copy_keeps_the_previous_text_on_failure(self):
        session = {"sentence": "旧句。", "story": {"sentence": "旧句。", "pages": [
            {"kind": "cover", "copy": "旧句。"},
            {"kind": "photo", "copy": "雾在路上。冷在镜头外。"},
        ]}}
        with self.assertRaises(RuntimeError):
            server.set_copy(session, 1, "只有一句。")
        self.assertEqual(session["story"]["pages"][1]["copy"], "雾在路上。冷在镜头外。")
        story = server.set_copy(session, 0, "新的一句。")
        self.assertEqual(story["sentence"], "新的一句。")
        self.assertEqual(session["sentence"], "新的一句。")
        self.assertEqual(story["pages"][0]["copy"], "新的一句。")

    def test_clear_drawing_leaves_photos(self):
        session = {"story": {"pages": [
            {"kind": "cover"}, {"kind": "drawing"}, {"kind": "photo"},
        ]}}
        story = server.clear_drawing(session)
        self.assertEqual([page["kind"] for page in story["pages"]], ["cover", "photo", "photo"])
        for page in story["pages"]:
            self.assertEqual(server.poster_error(page), "这一页不用画")

    def test_take_sentence_ignores_a_missing_field(self):
        session = {"sentence": "旧句。"}
        server.take_sentence(session, {})
        self.assertEqual(session["sentence"], "旧句。")
        server.take_sentence(session, {"sentence": "新句。"})
        self.assertEqual(session["sentence"], "新句。")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_essay_story.AuthorCopyTest -v`

Expected: FAIL，`author_sentence` 未定义。

- [ ] **Step 3: Implement the four functions and wire the three routes**

下标越界时 `set_copy` 抛出 `RuntimeError("没有这一页")`。`clear_drawing` 不要再调用 `assign_drawing`。`set_drawing` 保持现在的行为，用来在取消之后重新指定一页。

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.py tests/test_essay_story.py
git commit -m "feat: accept author copy and a book with no drawing"
```

### Task 3: 停留、裁切和折行

**Files:**
- Modify: `site/essay.js`
- Test: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: `FRAME`、`layoutCopy`、`sampleBook`。
- Produces:
  - `holdMs(page) -> number`。封面恒为 3000。正文是 `min(12000, 3000 + 120 * trim(copy).length)`。
  - `FADE_MS = 450`
  - `reelCues(pages) -> { fade, cues, total }`。`fade` 是 0.45 秒。每个 cue 有 `start` 和 `hold`（秒）。下一页的 `start` 是上一页的 `start + hold + fade`。`total` 是最后一页开始后再加上它的 `hold`，不再加一段淡出。没有页时 `total` 为 0。
  - `reelDurationLabel(pages) -> string`，形如 `约 28 秒`。
  - `imageFit(srcW, srcH) -> "contain" | "cover"`。高大于宽，或宽高未知，为 `contain`。其余为 `cover`。
  - `placeImage(srcW, srcH, destW, destH) -> { sx, sy, sw, sh, dx, dy, dw, dh }`。竖图取整张源图，等比放进目标矩形并居中。横图和方图按现在 `handoff.js` 的 `coverCrop` 铺满目标矩形，`dx`、`dy` 为 0，`dw`、`dh` 等于目标宽高。
  - `wrapLines(text, maxWidth, measure) -> string[]`。`layoutCopy` 改用它。一行以 `。，！？、` 开头且存在上一行时，把这些符号挪到上一行末尾。
  - `HOLD_MS` 先留着，Task 5 再删。

试册第 2 页和第 4 页换成规格里的两句。封面和第 3 页不动。

- [ ] **Step 1: Write the failing test**

```javascript
test("sample body pages say what the photo leaves out", () => {
  assert.equal(sampleBook.pages[1].copy, "路还在雾里，两边的树只剩一层浅色。雾把脚步声吃掉了，湿气停在镜头外面，照片里没有这层冷。");
  assert.equal(sampleBook.pages[3].copy, "这条巷子很窄，光只落在一边的墙上。说话的声音停在墙外面，照片里只剩下这一边的光。");
  assert.equal(sampleBook.pages[1].copy.length, 44);
  assert.equal(sampleBook.pages[3].copy.length, 40);
});

test("holds follow the page and cap at twelve seconds", () => {
  assert.equal(holdMs({ kind: "cover", title: "题".repeat(24), sentence: "句".repeat(80) }), 3000);
  assert.equal(holdMs({ kind: "photo", copy: "测".repeat(77) + "。完。" }), 12000);
  assert.equal(holdMs({ kind: "photo", copy: sampleBook.pages[1].copy }), 8280);
  const reel = reelCues(sampleBook.pages);
  assert.equal(reel.fade, 0.45);
  assert.equal(reel.cues[0].start, 0);
  assert.equal(reel.cues[0].hold, 3);
  assert.equal(reel.cues[1].start, 3.45);
  assert.equal(reel.total, 28.23);
  assert.equal(reelDurationLabel(sampleBook.pages), "约 28 秒");
});

test("a portrait sits inside the band and a landscape fills it", () => {
  assert.equal(imageFit(3, 4), "contain");
  assert.equal(imageFit(4, 3), "cover");
  assert.equal(imageFit(1, 1), "cover");
  assert.equal(imageFit(0, 0), "contain");
  assert.deepEqual(placeImage(3, 4, 1080, 1008), {
    sx: 0, sy: 0, sw: 3, sh: 4, dx: 162, dy: 0, dw: 756, dh: 1008,
  });
  const wide = placeImage(4, 3, 1080, 1008);
  assert.equal(wide.dx, 0);
  assert.equal(wide.dy, 0);
  assert.equal(wide.dw, 1080);
  assert.equal(wide.dh, 1008);
  assert.ok(wide.sw < 4);
});

test("punctuation does not open a line", () => {
  assert.deepEqual(wrapLines("雾气很冷。树", 4, (text) => text.length), ["雾气很冷。", "树"]);
});
```

现有的试册测试改成断言第 2 页 44 字、第 4 页 40 字，不再要求四页都是 `[17, 40, 40, 40]`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL，`holdMs` 未定义，或试册句子仍是旧的。

- [ ] **Step 3: Implement the exports in `site/essay.js`**

`reelCues` 的时间用秒。`holdMs` 用去掉首尾空白后的 `copy.length`，封面不看字数。`placeImage` 的竖图判断和 `imageFit` 相同。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/essay.js tests/essay.test.mjs
git commit -m "feat: time pages by length and keep portraits whole"
```

### Task 4: 草稿、一句话和画完后的一屏

**Files:**
- Modify: `site/essay.js`、`site/app.js`、`site/style.css`
- Test: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: `clear_drawing`、`set_copy`、`take_sentence` 的路由；`skipDrawing`。
- Produces:
  - `sentenceFields(draft, prior = {}) -> { sentence, note, checks }`。`prior.sentence` 有值（包括空字符串）时用它，否则用 `draft.sentence`。`checks[i].checked` 来自 `prior.answers[id]`。
  - `sentenceMarkup(fields) -> string`。含可编辑的句子、导语「这句话对吗？不对就直接改它。」、小标题「这几件发生过的，勾上」、补一句的输入，以及链接「不做了」。不含「放回书架」，不含「说不准的地方勾上」。
  - `copyCountLabel(text) -> string`，形如 `4 / 80`。
  - `copyEditor(index, text) -> string`。`textarea` 的 `maxlength` 是 80，`data-editor` 是下标；旁边是字数和按钮「改好」（`data-save`）。
  - `draftMarkup(story, photosById) -> string`。封面页框里是书名 `h1` 和句子。画页有角标「这一页将画成插画」和「改回照片」（`data-clear`）。其他正文页是「改成画」（`data-draw`）。说明是「字是替你起的稿，不对的地方直接改。」底部 `.draft-bar` 里，顺序是「就按这个做」（`data-choice="draw"`）、「都用原片」（`data-clear`，没有画页时不输出）、「回到勾选」（`data-choice="back"`）。正文段落带 `data-edit`。
  - `waitMarkup(title, index, url) -> string`。下标 2 时写出「正在画第 3 页」，并带上原片 `url`。
  - `reviewMarkup() -> string`。三个按钮的 `data-choice` 依次是 `keep`、`retry`、`original`，文案是「留下这幅」「再画一次」「用原片」。

`data-clear`、`data-edit`、`data-save` 不能同时带 `data-choice`。`waitForChoice` 只结束在「就按这个做」和「回到勾选」上。

- [ ] **Step 1: Write the failing test**

```javascript
test("sentence fields survive a round trip", () => {
  const fields = sentenceFields(
    { sentence: "旧句", checks: [{ id: "c1", text: "下过雪" }, { id: "none", text: "这几件都没发生" }] },
    { sentence: "新句", note: "雾很冷", answers: { c1: true } },
  );
  assert.equal(fields.sentence, "新句");
  assert.equal(fields.note, "雾很冷");
  assert.deepEqual(fields.checks.map((item) => item.checked), [true, false]);
  assert.equal(sentenceFields({ sentence: "旧句" }, { sentence: "" }).sentence, "");
  assert.equal(copyCountLabel(" 雾。冷。 "), "4 / 80");
});

test("sentence screen asks one question", () => {
  const html = sentenceMarkup({
    sentence: "雪停在远处。",
    note: "",
    checks: [{ id: "none", text: "这几件都没发生", checked: false }],
  });
  assert.match(html, /这句话对吗？不对就直接改它。/);
  assert.match(html, /这几件发生过的，勾上/);
  assert.match(html, /不做了/);
  assert.equal(html.includes("放回书架"), false);
  assert.equal(html.includes("说不准的地方勾上"), false);
});

test("draft marks the drawing and keeps the title inside the page", () => {
  const html = draftMarkup({
    title: "雪后",
    sentence: "雪停在远处，这一趟就从这里看过去。",
    pages: [
      { photoId: "a", kind: "cover", copy: "雪停在远处，这一趟就从这里看过去。" },
      { photoId: "b", kind: "drawing", copy: "雾。冷。" },
      { photoId: "c", kind: "photo", copy: "巷。静。" },
    ],
  }, new Map([["a", { url: "a.jpg" }], ["b", { url: "b.jpg" }], ["c", { url: "c.jpg" }]]));
  assert.match(html, /<h1>雪后<\/h1>/);
  assert.match(html, /这一页将画成插画/);
  assert.match(html, /改回照片/);
  assert.match(html, /data-draw="2"/);
  assert.match(html, /都用原片/);
  assert.match(html, /字是替你起的稿，不对的地方直接改。/);
  assert.match(html, /data-edit="0"/);
  assert.match(html, /data-edit="1"/);
  assert.match(html, /data-edit="2"/);
  assert.equal(html.includes("<h1 data-edit"), false);
  assert.equal(html.includes("data-draw=\"0\""), false);
  assert.equal(html.includes("data-draw=\"1\""), false);
});

test("the make flow uses those screens", () => {
  const app = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../site/style.css", import.meta.url), "utf8");
  assert.match(app, /sentenceMarkup\(sentenceFields/);
  assert.match(app, /\/api\/copy/);
  assert.match(app, /clear:\s*true/);
  assert.match(css, /\.draft-bar \{[^}]*position:\s*sticky/);
});

test("wait and review name the page and the three choices", () => {
  const waiting = waitMarkup("雪后", 2, "source.jpg");
  assert.match(waiting, /正在画第 3 页/);
  assert.match(waiting, /source\.jpg/);
  const review = reviewMarkup();
  assert.match(review, /留下这幅/);
  assert.match(review, /再画一次/);
  assert.match(review, /用原片/);
  assert.match(review, /data-choice="keep"/);
  assert.match(review, /data-choice="original"/);
});
```

把现有的 `draft shows the photo and a drawing control` 改成上面的草稿测试，不要两套互相矛盾的断言。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs`

Expected: FAIL，`sentenceFields` 或新草稿文案不存在。

- [ ] **Step 3: Implement the markup, then connect `app.js`**

`confirmSentence` 增加 `prior`。提交 `/api/story` 时带上当前句子。回到勾选时把当前句子、勾选和补充句放进 `prior`。

草稿里点 `data-edit` 换成 `copyEditor`。点「改好」，或点「就按这个做」时若编辑器还开着，先 `POST /api/copy`，用返回的故事重画。失败时把错误放进 `#make-error`，不重画。

`data-clear` 调用 `POST /api/drawing`，JSON 是 `{ session, clear: true }`，再用返回的故事重画。`data-draw` 仍提交 `{ session, index }`。

`drawBook` 的等待卡用 `waitMarkup`。画成功后用 `reviewMarkup` 等待选择：`keep` 留下这张画；`retry` 再请求一次；`original` 走 `skipDrawing` 并改用原片。失败屏的两个按钮不改。

书架说明改为「一次丢进一趟旅行的照片。先确认一句故事，再做成图文。」制作页提示改为「先确认这篇图文」。`.draft-bar` 吸在草稿底部，背景用 `--paper`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs && python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/essay.js site/app.js site/style.css tests/essay.test.mjs
git commit -m "feat: let the author edit the draft"
```

### Task 5: 阅读和导出

**Files:**
- Modify: `site/essay.js`、`site/app.js`、`site/style.css`、`site/handoff.js`
- Create: `tests/handoff.test.mjs`
- Test: `tests/essay.test.mjs`

**Interfaces:**
- Consumes: `holdMs`、`reelCues`、`reelDurationLabel`、`placeImage`、`imageFit`、`FRAME`、`exportSize`。
- Produces:
  - `pageLabel(index, total) -> string`，`pageLabel(1, 4)` 为 `2 / 4`。
  - `trackedWidth(text, fontSize, glyphWidth, trackingEm = 0) -> number`。字距只加在字与字之间。
  - `layoutCopy` 增加可选 `ranks`。缺省每块 22。返回里增加 `sizes`，短封面在 `ranks: [28, 22]` 时两种字号分别是 `28 * scale` 和 `22 * scale`。放不下时每种字号一起减，但不低于 `8 * scale`。原有的 `fontSize` 和 `lines` 仍在。
  - `videoLead(pages) -> string`，以 `reelDurationLabel` 结尾。
  - `handoffShell() -> string`。三个名字的 `aria-selected` 都是 `false`。没有「保存画面」。
  - `momentsMarkup(pack)` 只有一个主按钮「保存这一套」（`data-set="moments"`）。小图是 `data-look`，不是 `data-one`。
  - `filesFor(pack, "moments")` 返回封面加上后面几页。单张仍直接下载，多张的压缩包名是 `${stem}-朋友圈.zip`。
  - 删掉 `HOLD_MS`。预览和 `recordReel` 都走 `reelCues`。`.reel img` 的淡入是 `0.45s`。

- [ ] **Step 1: Write the failing test**

在 `tests/essay.test.mjs` 里删掉对 `HOLD_MS` 的导入和断言，保留 `FRAME` 那一条。把「页框没有 aspect-ratio」改成要求 `.essay-frame` 含 `aspect-ratio: 1080 / 1440`。再加：

```javascript
test("cover type has two sizes and the page number sits under the frame", () => {
  const scale = 1080 / 420;
  const laid = layoutCopy(["试册", "雪停在远处，这一趟就从这里看过去。"], {
    width: 1080,
    top: 1008 + 16 * scale,
    bottom: 1440 - 12 * scale,
    ranks: [28, 22],
    measure: (text, fontSize) => text.length * fontSize,
  });
  assert.equal(laid.sizes[0], 28 * scale);
  assert.equal(laid.sizes[1], 22 * scale);
  assert.equal(pageLabel(1, 4), "2 / 4");
  assert.equal(trackedWidth("试册", 28, () => 28, 0.12), 59.36);
  assert.equal(videoLead(sampleBook.pages), "竖屏，一页一页翻。约 28 秒");
});
```

新建 `tests/handoff.test.mjs`：

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import { handoffShell, momentsMarkup } from "../site/handoff.js";

test("handoff starts closed and moments has one save", () => {
  const shell = handoffShell();
  assert.equal(shell.includes("保存画面"), false);
  assert.equal(shell.includes('aria-selected="true"'), false);
  const html = momentsMarkup({
    cover: { name: "试册-朋友圈封面.jpg", preview: "cover.jpg" },
    squares: [{ name: "试册-朋友圈-02.jpg", preview: "two.jpg" }],
  });
  assert.match(html, /保存这一套/);
  assert.match(html, /data-look=/);
  assert.equal(html.includes("保存封面"), false);
  assert.equal(html.includes("保存后面几页"), false);
  assert.equal(html.includes("data-one"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/essay.test.mjs tests/handoff.test.mjs`

Expected: FAIL，`pageLabel` 或 `handoffShell` 未定义。

- [ ] **Step 3: Implement reading, type, and export**

页码放在页框下面，12px，颜色 `#8a8474`，居中。三个名字改为 15px，窄屏也是 15px。「发出去」保持 12px。

封面 `h1` 为 28px、字距 0.12em、`#282923`。封面句子用 `#6f6e64`、22px。不要再让 `.essay-copy h1, .essay-copy p` 把两者都设成 22px。导出时书名用 `trackedWidth` 测量，字距 0.12em；句子和正文不另加字距。

画面区：竖图 `object-fit: contain`，其余 `object-fit: cover`，背景都是纸色。图片还没知道宽高时用 `contain`。`paintEssay` 用 `placeImage` 画进 1008 高的区域，不再调用 `coverCrop`。

`mountHandoff` 初始不选中任何名字，舞台隐藏。再点已选中的名字就收起。点 `data-look` 只换大图。视频按钮旁用 `videoLead`。不再生成「保存画面」那一套文件。系统要求减少动态效果时，预览仍不自动播放。书架上的图和页里的图都在知道宽高之后加上 `imageFit` 给出的类；还不知道时保持整张放入。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/essay.test.mjs tests/handoff.test.mjs && python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 5: Check the sample book in the browser**

Run: `python3 server.py`

打开 `http://127.0.0.1:8765`，再打开试册。页框下有「1 / 4」。三个名字没有展开。点「视频」能看到「约 28 秒」，预览会自己往下翻。点「朋友圈」后，点小图不会下载。竖图两侧是纸色，横图仍铺满。

- [ ] **Step 6: Commit**

```bash
git add site/essay.js site/app.js site/style.css site/handoff.js tests/essay.test.mjs tests/handoff.test.mjs
git commit -m "feat: read the essay before the export opens"
```

### Task 6: 说明

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 前五个任务的可见行为。
- Produces: 与规格一致的使用说明。不新增接口文档以外的行为。

- [ ] **Step 1: Update `README.md`**

一句话那一步写「这句话对吗？不对就直接改它。」和「这几件都没发生」。草稿那一步写明可以改字、可以改成画、也可以都用原片。成图那一步写「正在画第 N 页」，以及画成后的「留下这幅 / 再画一次 / 用原片」。

「发出去」写明打开时不展开。朋友圈只留「保存这一套」。删掉「保存画面」这一节，并写明全部 1080×1440 从小红书的「保存这一套」拿走。视频写明封面 3 秒、正文按字数停留、最长 12 秒，预览和保存同一条时间。

制作过程里的第 3 步改退路文案。第 4 步写明 `draw` 可以一页都没有。补上 `POST /api/copy`，以及 `POST /api/drawing` 在 `clear` 为真时去掉画页。目录表里 `handoff.js` 不再写「保存画面」。

- [ ] **Step 2: Search for the retired phrases**

Run: `rg -n "纸刊|保存画面|都没有，故事不是这样|再画成纸刊" README.md site server.py`

Expected: 无匹配。`docs/superpowers/` 里的旧计划可以保留这些词。

- [ ] **Step 3: Run the tests again**

Run: `node --test tests/essay.test.mjs tests/handoff.test.mjs && python3 -m unittest tests.test_essay_story -v`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the revised essay"
```
