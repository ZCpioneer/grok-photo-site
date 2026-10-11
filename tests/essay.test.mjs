import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FRAME, coverSize, moveDrawing, isLegacy, essayMarkup, sampleBook, readingShell, draftMarkup, pagesToStore, skipDrawing, exportSize, pageTurn, layoutCopy, holdMs, reelCues, reelDurationLabel, imageFit, placeImage, wrapLines, sentenceFields, sentenceMarkup, copyCountLabel, waitMarkup, reviewMarkup, pageLabel, trackedWidth, videoLead, fitRanks, restoredSentence } from "../site/essay.js";

test("frame and hold", () => {
  assert.deepEqual(FRAME, { width: 1080, height: 1440, imageHeight: 1008 });
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

test("reading shell puts the essay before the handoff", () => {
  const html = readingShell();
  const essay = html.indexOf('id="essay"');
  const send = html.indexOf("发出去");
  const handoff = html.indexOf('id="handoff"');
  assert.ok(essay !== -1 && send !== -1 && handoff !== -1);
  assert.ok(essay < send && send < handoff);
  assert.equal(html.includes("翻册"), false);
});

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

test("the make flow uses those screens", () => {
  const app = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../site/style.css", import.meta.url), "utf8");
  assert.match(app, /sentenceMarkup\(sentenceFields/);
  assert.match(app, /\/api\/copy/);
  assert.match(css, /\.draft-bar \{[^}]*position:\s*sticky/);
  assert.match(app, /clear:\s*true/);
});

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

test("copy clicks do not turn the page", () => {
  const bounds = { left: 0, width: 100 };
  assert.equal(pageTurn(10, bounds, true), 0);
  assert.equal(pageTurn(10, bounds, false), -1);
  assert.equal(pageTurn(80, bounds, false), 1);
});

test("a long cover sentence stays inside the export", () => {
  const scale = 1080 / 420;
  const top = 1008 + 16 * scale;
  const bottom = 1440 - 12 * scale;
  const title = "题".repeat(24);
  const sentence = "句".repeat(80);
  const laid = layoutCopy([title, sentence], {
    width: 1080,
    top,
    bottom,
    measure: (text, fontSize) => text.length * fontSize,
  });
  const kept = laid.lines.filter(Boolean).join("");
  assert.equal(kept, title + sentence);
  const lineHeight = laid.fontSize * 1.55;
  const used = laid.lines.reduce((sum, line) => sum + (line ? lineHeight : lineHeight * 0.4), 0);
  assert.ok(used <= bottom - top);
});

test("the reading column does not scroll the copy away", () => {
  const css = readFileSync(new URL("../site/style.css", import.meta.url), "utf8");
  const frame = css.split("\n").find((line) => line.startsWith(".essay-frame {"));
  const copy = css.split("\n").find((line) => line.startsWith(".essay-copy {"));
  assert.equal(frame.includes("overflow"), false);
  assert.match(frame, /aspect-ratio:\s*1080\s*\/\s*1440/);
  assert.equal(copy.includes("overflow"), false);
});

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

test("screen type shrinks together and stops at eight", () => {
  assert.deepEqual(fitRanks([28, 22], 1, () => false), [28, 22]);
  assert.deepEqual(fitRanks([28, 22], 1, (current) => current[1] > 16), [22, 16]);
  assert.deepEqual(fitRanks([28, 22], 1, () => true), [8, 8]);
  const source = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  assert.match(source, /fitRanks\(/);
});

test("each open editor is saved, and back keeps the cover line", () => {
  assert.equal(restoredSentence("旧句", undefined), "旧句");
  assert.equal(restoredSentence("旧句", "新句"), "新句");
  assert.equal(restoredSentence("旧句", ""), "");
  const source = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  assert.match(source, /querySelectorAll\("\[data-editor\]"\)/);
  assert.match(source, /restoredSentence\(current\.sentence/);
});

test("exports keep the whole 3:4 page", () => {
  assert.deepEqual(exportSize("cover"), { width: 1125, height: 1500 });
  assert.deepEqual(exportSize("page"), { width: 1080, height: 1440 });
});

test("sample book is the four-page essay", () => {
  assert.equal(sampleBook.pages.map((page) => page.kind).join(","), "cover,photo,drawing,photo");
  assert.equal(sampleBook.sentence.length, 17);
  assert.deepEqual(sampleBook.pages.map((page) => page.copy.length), [17, 44, 40, 40]);
  assert.equal(sampleBook.pages[2].url, "assets/sample/03.png");
  assert.equal(sampleBook.pages[0].url, "assets/sample/photos/terraces.jpg");
});

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
