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
