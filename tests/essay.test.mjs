import assert from "node:assert/strict";
import test from "node:test";
import { FRAME, HOLD_MS, coverSize, moveDrawing, isLegacy, essayMarkup, sampleBook } from "../site/essay.js";

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

test("sample book is the four-page essay", () => {
  assert.equal(sampleBook.pages.map((page) => page.kind).join(","), "cover,photo,drawing,photo");
  assert.equal(sampleBook.sentence.length, 17);
  assert.deepEqual(sampleBook.pages.map((page) => page.copy.length), [17, 40, 40, 40]);
  assert.equal(sampleBook.pages[2].url, "assets/sample/03.png");
  assert.equal(sampleBook.pages[0].url, "assets/sample/photos/terraces.jpg");
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
