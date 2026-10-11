const SENTENCE = "雪停在远处，这一趟就从这里看过去。";

export const sampleBook = {
  id: "sample",
  title: "试册",
  sentence: SENTENCE,
  created: 0,
  sample: true,
  pages: [
    { url: "assets/sample/photos/terraces.jpg", kind: "cover", copy: SENTENCE },
    {
      url: "assets/sample/photos/fog-road.jpg",
      kind: "photo",
      copy: "路还在雾里，两边的树只剩一层浅色。雾把脚步声吃掉了，湿气停在镜头外面，照片里没有这层冷。",
    },
    {
      url: "assets/sample/03.png",
      kind: "drawing",
      copy: "盘子里只有一点点，手刚从右边离开。那一顿比这张画停得更久，味道一点都没被拍下来。",
    },
    {
      url: "assets/sample/photos/alley.jpg",
      kind: "photo",
      copy: "这条巷子很窄，光只落在一边的墙上。说话的声音停在墙外面，照片里只剩下这一边的光。",
    },
  ],
};

export const FRAME = { width: 1080, height: 1440, imageHeight: 1008 };
export const HOLD_MS = 3500;
export const FADE_MS = 450;

export function holdMs(page) {
  if (page?.kind === "cover") return 3000;
  const count = String(page?.copy ?? "").trim().length;
  return Math.min(12000, 3000 + 120 * count);
}

export function reelCues(pages) {
  const fade = FADE_MS / 1000;
  let start = 0;
  const cues = (pages || []).map((page) => {
    const hold = holdMs(page) / 1000;
    const cue = { start, hold };
    start += hold + fade;
    return cue;
  });
  const total = cues.length ? start - fade : 0;
  return { fade, cues, total };
}

export function reelDurationLabel(pages) {
  return `约 ${Math.round(reelCues(pages).total)} 秒`;
}

export function imageFit(srcW, srcH) {
  if (!srcW || !srcH || srcH > srcW) return "contain";
  return "cover";
}

export function placeImage(srcW, srcH, destW, destH) {
  if (imageFit(srcW, srcH) === "contain") {
    const scale = Math.min(destW / srcW, destH / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: (destW - dw) / 2, dy: (destH - dh) / 2, dw, dh };
  }
  const destRatio = destW / destH;
  const srcRatio = srcW / srcH;
  if (srcRatio > destRatio) {
    const sw = srcH * destRatio;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH, dx: 0, dy: 0, dw: destW, dh: destH };
  }
  const sh = srcW / destRatio;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh, dx: 0, dy: 0, dw: destW, dh: destH };
}

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

export function exportSize(name) {
  if (name === "cover") return coverSize(FRAME.width, FRAME.height);
  return { width: FRAME.width, height: FRAME.height };
}

export function pageTurn(clientX, bounds, inText) {
  if (inText || !bounds?.width) return 0;
  return clientX < bounds.left + bounds.width / 2 ? -1 : 1;
}

const HANG = "。，！？、";

export function wrapLines(text, maxWidth, measure) {
  const lines = [];
  let line = "";
  for (const char of String(text)) {
    const next = line + char;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  for (let index = 1; index < lines.length; index += 1) {
    while (lines[index] && HANG.includes(lines[index][0])) {
      lines[index - 1] += lines[index][0];
      lines[index] = lines[index].slice(1);
    }
  }
  return lines.filter((item) => item);
}

export function layoutCopy(blocks, { width, top, bottom, measure, scale = width / 420 }) {
  const maxWidth = width - 22 * scale * 2;
  const build = (fontSize) => blocks.flatMap((block, index) => {
    const lines = wrapLines(String(block).trim(), maxWidth, (text) => measure(text, fontSize));
    return index ? ["", ...lines] : lines;
  });
  const used = (fontSize, lines) => {
    const lineHeight = fontSize * 1.55;
    return lines.reduce((sum, line) => sum + (line ? lineHeight : lineHeight * 0.4), 0);
  };
  let fontSize = 22 * scale;
  const minSize = 8 * scale;
  let lines = build(fontSize);
  while (fontSize > minSize && top + used(fontSize, lines) > bottom) {
    fontSize -= 1;
    lines = build(fontSize);
  }
  return { fontSize, lines };
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

export function pagesToStore(storyPages, ids) {
  if (ids.length !== storyPages.length) throw new Error("页数和编号对不上");
  return storyPages.map((page, index) => ({
    posterId: ids[index],
    kind: page.kind,
    copy: page.copy ?? "",
  }));
}

export function skipDrawing(pages, index) {
  return pages.map((page, position) => (
    position === index && page.kind === "drawing" ? { ...page, kind: "photo" } : { ...page }
  ));
}

export function draftMarkup(story, photosById) {
  const pages = story.pages.map((page, index) => {
    const photo = photosById.get(page.photoId);
    const image = `<img class="essay-image" src="${escapeHtml(photo?.url || "")}" alt="">`;
    const copy = String(page.copy ?? "").trim();
    const text = copy ? `<div class="essay-copy"><p>${escapeHtml(copy)}</p></div>` : "";
    const control = page.kind === "cover"
      ? ""
      : `<div class="actions"><button class="quiet" type="button" data-draw="${index}">改成画</button></div>`;
    return `<section class="draft-page"><div class="essay-frame"><article class="essay-page">${image}${text}</article></div>${control}</section>`;
  }).join("");
  return `${pages}<div class="actions"><button class="primary" type="button" data-choice="draw">就按这个做</button></div>`;
}

export function readingShell() {
  return '<p class="return-link"><a href="#/">放回书架</a></p><div id="essay"></div><p class="essay-send">发出去</p><div id="handoff"></div>';
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
