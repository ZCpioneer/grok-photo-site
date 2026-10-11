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
export const FADE_MS = 450;

export function pageLabel(index, total) {
  return `${index + 1} / ${total}`;
}

export function fitRanks(ranks, scale, tooTall) {
  const minSize = 8 * scale;
  let sizes = ranks.map((rank) => rank * scale);
  let guard = 0;
  while (tooTall(sizes) && sizes.some((size) => size > minSize) && guard < 400) {
    sizes = sizes.map((size) => Math.max(minSize, size - 1));
    guard += 1;
  }
  return sizes;
}

export function restoredSentence(storySentence, editorValue) {
  if (editorValue != null) return editorValue;
  return storySentence ?? "";
}

export function trackedWidth(text, fontSize, glyphWidth, trackingEm = 0) {
  const chars = [...String(text)];
  if (!chars.length) return 0;
  const gap = trackingEm * fontSize;
  let width = 0;
  chars.forEach((char, index) => {
    width += glyphWidth(char, fontSize);
    if (index < chars.length - 1) width += gap;
  });
  return width;
}

export function videoLead(pages) {
  return `竖屏，一页一页翻。${reelDurationLabel(pages)}`;
}

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

export function layoutCopy(blocks, { width, top, bottom, measure, scale = width / 420, ranks }) {
  const maxWidth = width - 22 * scale * 2;
  const minSize = 8 * scale;
  const bases = blocks.map((_, index) => (ranks && ranks[index] != null ? ranks[index] : 22));
  const build = (sizes) => {
    const lines = [];
    const lineSizes = [];
    const lineBlocks = [];
    blocks.forEach((block, index) => {
      const fontSize = sizes[index];
      if (index) {
        lines.push("");
        lineSizes.push(fontSize);
        lineBlocks.push(index);
      }
      wrapLines(String(block).trim(), maxWidth, (text) => measure(text, fontSize, index)).forEach((line) => {
        lines.push(line);
        lineSizes.push(fontSize);
        lineBlocks.push(index);
      });
    });
    return { lines, lineSizes, lineBlocks };
  };
  const used = (lines, lineSizes) => lines.reduce((sum, line, index) => {
    const lineHeight = lineSizes[index] * 1.55;
    return sum + (line ? lineHeight : lineHeight * 0.4);
  }, 0);
  let sizes = bases.map((rank) => rank * scale);
  let built = build(sizes);
  while (sizes.some((size) => size > minSize) && top + used(built.lines, built.lineSizes) > bottom) {
    sizes = sizes.map((size) => Math.max(minSize, size - 1));
    built = build(sizes);
  }
  return { fontSize: sizes[0] ?? 22 * scale, lines: built.lines, sizes, lineSizes: built.lineSizes, lineBlocks: built.lineBlocks };
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

export function sentenceFields(draft, prior = {}) {
  const answers = prior.answers || {};
  return {
    sentence: prior.sentence ?? draft?.sentence ?? "",
    note: prior.note ?? "",
    checks: (draft?.checks || []).map((item) => ({
      id: item.id,
      text: item.text,
      checked: Boolean(answers[item.id]),
    })),
  };
}

export function sentenceMarkup(fields) {
  const checks = (fields.checks || []).map((item) => `
    <label class="check">
      <input type="checkbox" name="check" value="${escapeHtml(item.id)}"${item.checked ? " checked" : ""}>
      <span>${escapeHtml(item.text)}</span>
    </label>`).join("");
  return `
    <p class="lead">这句话对吗？不对就直接改它。</p>
    <textarea class="sentence" id="sentence" maxlength="80">${escapeHtml(fields.sentence || "")}</textarea>
    <p class="kicker">这几件发生过的，勾上</p>
    ${checks}
    <input class="note" id="note" maxlength="200" placeholder="补一句你记得的，也可以空着" value="${escapeHtml(fields.note || "")}">
    <div class="actions">
      <button class="primary" type="button" id="to-story">按这些重写故事</button>
      <a class="quiet" href="#/">不做了</a>
    </div>`;
}

export function copyCountLabel(text) {
  return `${String(text ?? "").trim().length} / 80`;
}

export function copyEditor(index, text) {
  const value = String(text ?? "");
  return `<textarea data-editor="${index}" maxlength="80">${escapeHtml(value)}</textarea><span data-count>${copyCountLabel(value)}</span><button type="button" data-save="${index}">改好</button>`;
}

export function draftMarkup(story, photosById) {
  const hasDrawing = story.pages.some((page) => page.kind === "drawing");
  const pages = story.pages.map((page, index) => {
    const photo = photosById.get(page.photoId);
    const image = `<img class="essay-image" src="${escapeHtml(photo?.url || "")}" alt="">`;
    const mark = page.kind === "drawing" ? `<span class="mark">这一页将画成插画</span>` : "";
    let text = "";
    if (page.kind === "cover") {
      const sentence = String(story.sentence ?? page.copy ?? "").trim();
      text = `<div class="essay-copy"><h1>${escapeHtml(story.title || "")}</h1>${sentence ? `<p data-edit="0">${escapeHtml(sentence)}</p>` : `<p data-edit="0"></p>`}</div>`;
    } else {
      const copy = String(page.copy ?? "").trim();
      text = `<div class="essay-copy"><p data-edit="${index}">${escapeHtml(copy)}</p></div>`;
    }
    const control = page.kind === "cover"
      ? ""
      : page.kind === "drawing"
        ? `<div class="actions"><button class="quiet" type="button" data-clear="${index}">改回照片</button></div>`
        : `<div class="actions"><button class="quiet" type="button" data-draw="${index}">改成画</button></div>`;
    return `<section class="draft-page"><div class="essay-frame"><article class="essay-page essay-${page.kind}">${mark}${image}${text}</article></div>${control}</section>`;
  }).join("");
  const clear = hasDrawing ? `<button class="quiet" type="button" data-clear="all">都用原片</button>` : "";
  return `<p class="lead">字是替你起的稿，不对的地方直接改。</p>${pages}<div class="draft-bar"><button class="primary" type="button" data-choice="draw">就按这个做</button>${clear}<button class="quiet" type="button" data-choice="back">回到勾选</button></div>`;
}

export function waitMarkup(title, index, url) {
  return `<p class="kicker">${escapeHtml(title)}</p><p class="sentence">正在画第 ${index + 1} 页</p><img src="${escapeHtml(url)}" alt=""><p class="lead">只有这一页要画。其余的页用原来的照片。</p>`;
}

export function reviewMarkup() {
  return `<div class="actions"><button class="primary" type="button" data-choice="keep">留下这幅</button><button class="quiet" type="button" data-choice="retry">再画一次</button><button class="quiet" type="button" data-choice="original">用原片</button></div>`;
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
