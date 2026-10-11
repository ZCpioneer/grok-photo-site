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
      copy: "路还在雾里，两边的树只剩一层浅色。我们没有再往前走，照片把这段空空地停在了这里。",
    },
    {
      url: "assets/sample/03.png",
      kind: "drawing",
      copy: "盘子里只有一点点，手刚从右边离开。那一顿比这张画停得更久，味道一点都没被拍下来。",
    },
    {
      url: "assets/sample/photos/alley.jpg",
      kind: "photo",
      copy: "这条巷子很窄，光只落在一边的墙上。我们在这儿站了一会儿，照片没能留下说话的声音。",
    },
  ],
};

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
