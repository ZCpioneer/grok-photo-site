export const FRAME = { width: 1080, height: 1440, imageHeight: 1008 };
export const HOLD_MS = 3500;

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPE[char]);
}

export function coverSize(srcW, srcH, longEdge = 1500) {
  const long = Math.max(srcW, srcH);
  if (!long) return { width: 0, height: 0 };
  const scale = longEdge / long;
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

export function moveDrawing(pages, index) {
  const copy = pages.map((page) => ({ ...page }));
  if (index <= 0 || index >= pages.length || pages.length < 2) return copy;
  return copy.map((page, position) => ({
    ...page,
    kind: position === 0 ? "cover" : position === index ? "drawing" : "photo",
  }));
}

export function isLegacy(page) {
  return page.kind == null || page.kind === "legacy";
}

export function essayMarkup(page) {
  const image = `<img class="essay-image" src="${escapeHtml(page.url)}" alt="">`;
  if (isLegacy(page)) return `<figure class="essay-legacy">${image}</figure>`;
  const kind = page.kind === "drawing" ? "drawing" : page.kind === "cover" ? "cover" : "photo";
  let text = "";
  if (kind === "cover") {
    const sentence = String(page.sentence ?? "").trim();
    text = `<h1>${escapeHtml(page.title)}</h1>${sentence ? `<p>${escapeHtml(sentence)}</p>` : ""}`;
  } else {
    const copy = String(page.copy ?? "").trim();
    text = copy ? `<p>${escapeHtml(copy)}</p>` : "";
  }
  const copyBlock = text ? `<div class="essay-copy">${text}</div>` : "";
  return `<article class="essay-page essay-${kind}">${image}${copyBlock}</article>`;
}
