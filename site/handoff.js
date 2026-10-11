const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function fileStem(title) {
  const cleaned = String(title || "册子").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
  return (cleaned || "册子").slice(0, 24);
}

export function captionOf(book) {
  const sentence = String(book?.sentence || "").replace(/\s+/g, " ").trim();
  if (sentence) return sentence;
  const title = String(book?.title || "").trim();
  return title || "一趟旅行";
}

// The English line sits near the bottom of a 3:5 poster. A square or 3:4 frame
// keeps that bottom and drops empty paper from the top.
export function frameRect(srcW, srcH, ratio) {
  const srcRatio = srcW / srcH;
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;
  if (srcRatio < ratio) {
    sh = srcW / ratio;
    sy = srcH - sh;
  } else if (srcRatio > ratio) {
    sw = srcH * ratio;
    sx = (srcW - sw) / 2;
  }
  sx = Math.max(0, Math.round(sx));
  sy = Math.max(0, Math.round(sy));
  sw = Math.min(srcW - sx, Math.round(sw));
  sh = Math.min(srcH - sy, Math.round(sh));
  return { sx, sy, sw, sh };
}

export function coverSize(srcW, srcH, longEdge = 1500) {
  const scale = Math.min(1, longEdge / Math.max(srcW, srcH));
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  };
}

export function zipStore(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = file.bytes;
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  });
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end], { type: "application/zip" });
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function ext(blob) {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  return "png";
}

function track(urls, blob) {
  const url = URL.createObjectURL(blob);
  urls.push(url);
  return url;
}

function jpeg(canvas) {
  return new Promise((resolve, reject) => {
    const attempt = (quality) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("图没有做成"));
          return;
        }
        if (blob.size > 480000 && quality > 0.62) {
          attempt(Math.round((quality - 0.08) * 100) / 100);
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    };
    attempt(0.86);
  });
}

function drawCrop(image, ratio, width, height) {
  const rect = frameRect(image.width, image.height, ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
  return canvas;
}

function drawScaled(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

async function prepare(book, urls, cancelled) {
  const stem = fileStem(book.title);
  const masters = [];
  const squares = [];
  const xhs = [];
  let cover = null;
  for (let index = 0; index < book.pages.length; index += 1) {
    if (cancelled()) throw new Error("cancelled");
    const page = book.pages[index];
    const response = await fetch(page.url);
    if (!response.ok) throw new Error("这一页读不出来");
    const blob = await response.blob();
    const image = await createImageBitmap(blob);
    const n = String(index + 1).padStart(2, "0");
    masters.push({
      blob,
      name: `${stem}-母版-${n}.${ext(blob)}`,
      line: page.line,
      preview: page.url,
    });
    const square = await jpeg(drawCrop(image, 1, 1080, 1080));
    const card = await jpeg(drawCrop(image, 3 / 4, 1080, 1440));
    squares.push({
      blob: square,
      name: `${stem}-朋友圈-${n}.jpg`,
      line: page.line,
      preview: track(urls, square),
    });
    xhs.push({
      blob: card,
      name: `${stem}-小红书-${n}.jpg`,
      line: page.line,
      preview: track(urls, card),
    });
    if (index === 0) {
      const size = coverSize(image.width, image.height);
      const coverBlob = await jpeg(drawScaled(image, size.width, size.height));
      cover = {
        blob: coverBlob,
        name: `${stem}-朋友圈封面.jpg`,
        line: page.line,
        preview: track(urls, coverBlob),
      };
    }
    image.close?.();
  }
  return { masters, squares, xhs, cover, caption: captionOf(book) };
}

function shot(file, group, index) {
  return `<button class="shot" type="button" data-one="${group}:${index}" aria-label="保存${escape(file.name)}"><img src="${file.preview}" alt="${escape(file.line || "")}"></button>`;
}

function momentsMarkup(pack) {
  const squares = pack.squares.map((file, index) => shot(file, "squares", index)).join("");
  return `
    <p class="lead">高的那张单独发。方格一起发。</p>
    <div class="moments-stage">
      <div class="piece">
        <button class="shot cover-shot" type="button" data-one="cover:0" aria-label="保存${escape(pack.cover.name)}"><img src="${pack.cover.preview}" alt="${escape(pack.cover.line || "")}"></button>
        <div class="actions"><button class="primary" type="button" data-set="cover">保存封面</button></div>
      </div>
      <div class="piece grid-piece">
        <div class="grid-preview" data-count="${pack.squares.length}">${squares}</div>
        <div class="actions"><button class="primary" type="button" data-set="squares">保存方格</button></div>
      </div>
    </div>`;
}

function xhsMarkup(pack, index) {
  const page = pack.xhs[index];
  const thumbs = pack.xhs.map((file, i) => `
    <button type="button" data-xhs="${i}" aria-current="${i === index ? "true" : "false"}" aria-label="第 ${i + 1} 张">
      <img src="${file.preview}" alt="">
    </button>`).join("");
  return `
    <div class="xhs-stage">
      <div class="xhs-hero">
        ${index === 0 ? `<span class="mark">封面</span>` : ""}
        <img src="${page.preview}" alt="${escape(page.line || "")}">
        <button class="xhs-hit left" type="button" data-xhs-step="-1" aria-label="上一张"></button>
        <button class="xhs-hit right" type="button" data-xhs-step="1" aria-label="下一张"></button>
      </div>
      <div class="xhs-copy">
        <p class="caption">${escape(pack.caption)}</p>
        <div class="actions">
          <button class="primary" type="button" data-set="xhs">保存这一套</button>
          <button class="quiet" type="button" data-copy="1">复制这句话</button>
        </div>
        <p class="error" data-copy-error hidden>没有复制成。这句话可以选择后自己复制。</p>
        <div class="xhs-thumbs">${thumbs}</div>
      </div>
    </div>`;
}

function videoMarkup(book) {
  const frames = book.pages.map((page, index) => `<img src="${page.url}" alt="${escape(page.line || "")}" class="${index === 0 ? "on" : ""}">`).join("");
  return `
    <div class="reel" data-reel>${frames}</div>
    <p class="lead">竖屏，一页一页翻。</p>
    <div class="actions"><button class="primary" type="button" data-video="1">保存视频</button></div>
    <p class="error" data-video-error hidden>这台浏览器做不成视频。画面可以在这里看。</p>`;
}

function filesFor(pack, key) {
  if (key === "cover") return [pack.cover];
  if (key === "masters") return pack.masters;
  if (key === "squares") return pack.squares;
  return pack.xhs;
}

function zipName(key, title) {
  const stem = fileStem(title);
  if (key === "masters") return `${stem}-母版.zip`;
  if (key === "squares") return `${stem}-朋友圈方格.zip`;
  return `${stem}-小红书.zip`;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function asFiles(files) {
  return files.map((file) => new File([file.blob], file.name, { type: file.blob.type || "image/jpeg" }));
}

function wantsSheet() {
  return matchMedia("(pointer: coarse)").matches && matchMedia("(max-width: 760px)").matches;
}

async function zipBlob(files) {
  const entries = await Promise.all(files.map(async (file) => ({
    name: file.name,
    bytes: new Uint8Array(await file.blob.arrayBuffer()),
  })));
  return zipStore(entries);
}

async function give(files, name) {
  if (wantsSheet() && navigator.canShare) {
    const payload = asFiles(files);
    let shareable = false;
    try {
      shareable = navigator.canShare({ files: payload });
    } catch {
      shareable = false;
    }
    if (shareable) {
      try {
        await navigator.share({ files: payload });
        return "shared";
      } catch (error) {
        if (error && error.name === "AbortError") return "abort";
      }
    }
  }
  if (files.length === 1) {
    saveBlob(files[0].blob, files[0].name);
    return "saved";
  }
  saveBlob(await zipBlob(files), name);
  return "saved";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-999px";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function flash(button, text) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  window.setTimeout(() => {
    if (button.textContent === text) button.textContent = original;
  }, 1600);
}

function drawPaper(ctx, image, width, height, alpha) {
  ctx.globalAlpha = alpha;
  if (alpha === 1) {
    ctx.fillStyle = "#f3eedf";
    ctx.fillRect(0, 0, width, height);
  }
  const scale = Math.min(width / image.width, height / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

async function recordReel(pages, title) {
  const width = 720;
  const height = 1280;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const bitmaps = [];
  for (const page of pages) {
    const response = await fetch(page.url);
    if (!response.ok) throw new Error("这一页读不出来");
    bitmaps.push(await createImageBitmap(await response.blob()));
  }
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
  if (!mime || typeof canvas.captureStream !== "function") throw new Error("unsupported");
  const fade = 0.45;
  const hold = Math.max(1.6, Math.min(3, 13 / pages.length));
  const span = hold + fade;
  const total = pages.length * span - fade;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  const paint = (time) => {
    const pos = Math.min(pages.length - 1, time / span);
    const index = Math.min(pages.length - 1, Math.floor(pos));
    const local = pos - index;
    drawPaper(ctx, bitmaps[index], width, height, 1);
    if (index < pages.length - 1 && local > hold) {
      drawPaper(ctx, bitmaps[index + 1], width, height, Math.min(1, (local - hold) / fade));
    }
  };
  paint(0);
  recorder.start();
  await new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const time = (performance.now() - started) / 1000;
      if (time >= total) {
        resolve();
        return;
      }
      paint(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await stopped;
  bitmaps.forEach((image) => image.close?.());
  stream.getTracks().forEach((track) => track.stop());
  const extension = mime.includes("mp4") ? "mp4" : "webm";
  return { blob: new Blob(chunks, { type: mime }), name: `${fileStem(title)}-视频.${extension}` };
}

export function mountHandoff(host, book, hooks = {}) {
  let cancelled = false;
  let pack = null;
  let format = "moments";
  let xhsIndex = 0;
  let reelTimer = 0;
  const urls = [];
  host.innerHTML = `
    <section class="handoff">
      <div class="format-row">
        <div class="formats" role="tablist" aria-label="发出去的形式">
          <button type="button" role="tab" data-format="moments" aria-selected="true">朋友圈</button>
          <button type="button" role="tab" data-format="xhs" aria-selected="false">小红书</button>
          <button type="button" role="tab" data-format="video" aria-selected="false">视频</button>
        </div>
        <button class="linkish" type="button" data-set="masters">保存原图</button>
      </div>
      <div class="stage"></div>
    </section>`;
  const stage = host.querySelector(".stage");
  const mastersButton = host.querySelector("[data-set='masters']");
  mastersButton.disabled = true;

  function stopReel() {
    window.clearInterval(reelTimer);
    reelTimer = 0;
  }

  function startReel() {
    stopReel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = stage.querySelector("[data-reel]");
    if (!frame) return;
    const images = [...frame.querySelectorAll("img")];
    if (images.length < 2) return;
    let index = 0;
    reelTimer = window.setInterval(() => {
      images[index].classList.remove("on");
      index = (index + 1) % images.length;
      images[index].classList.add("on");
    }, 2800);
  }

  function markTabs() {
    host.querySelectorAll("[data-format]").forEach((button) => {
      button.setAttribute("aria-selected", button.dataset.format === format ? "true" : "false");
    });
  }

  function renderStage() {
    stage.hidden = false;
    if (format === "video") {
      stage.innerHTML = videoMarkup(book);
      startReel();
      return;
    }
    stopReel();
    if (!pack) {
      stage.innerHTML = `<p class="lead">正在准备这一版。</p>`;
      return;
    }
    if (format === "xhs") {
      xhsIndex = Math.max(0, Math.min(pack.xhs.length - 1, xhsIndex));
      stage.innerHTML = xhsMarkup(pack, xhsIndex);
      return;
    }
    stage.innerHTML = momentsMarkup(pack);
  }

  function readBook() {
    stopReel();
    format = "";
    markTabs();
    stage.hidden = true;
    hooks.openBook?.();
  }

  const onClick = async (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.format) {
      format = button.dataset.format;
      hooks.closeBook?.();
      markTabs();
      renderStage();
      return;
    }
    if (button.dataset.xhsStep || button.dataset.xhs != null) {
      if (!pack) return;
      const count = pack.xhs.length;
      if (button.dataset.xhs != null) xhsIndex = Number(button.dataset.xhs);
      else xhsIndex = (xhsIndex + Number(button.dataset.xhsStep) + count) % count;
      renderStage();
      return;
    }
    if (button.dataset.video) {
      const error = stage.querySelector("[data-video-error]");
      if (error) error.hidden = true;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "正在做成视频";
      try {
        const file = await recordReel(book.pages, book.title);
        if (cancelled) return;
        saveBlob(file.blob, file.name);
        button.dataset.label = original;
        flash(button, "已保存");
      } catch {
        if (error) error.hidden = false;
        button.textContent = original;
      }
      button.disabled = false;
      return;
    }
    if (!pack) return;
    if (button.dataset.copy) {
      button.disabled = true;
      const ok = await copyText(pack.caption);
      button.disabled = false;
      const error = stage.querySelector("[data-copy-error]");
      if (error) error.hidden = ok;
      if (ok) flash(button, "已复制");
      return;
    }
    let files = null;
    let name = "";
    if (button.dataset.one) {
      const [group, index] = button.dataset.one.split(":");
      files = [filesFor(pack, group)[Number(index)]];
      name = files[0].name;
    } else if (button.dataset.set) {
      files = filesFor(pack, button.dataset.set);
      name = zipName(button.dataset.set, book.title);
    }
    if (!files?.[0]) return;
    button.disabled = true;
    const outcome = await give(files, name);
    button.disabled = false;
    if (outcome !== "abort") flash(button, "已保存");
  };

  host.addEventListener("click", onClick);
  renderStage();
  prepare(book, urls, () => cancelled).then((result) => {
    if (cancelled) return;
    pack = result;
    mastersButton.disabled = false;
    if (format === "moments" || format === "xhs") renderStage();
  }).catch((error) => {
    if (cancelled || error?.message === "cancelled") return;
    if (format !== "video") stage.innerHTML = `<p class="error">朋友圈和小红书这版没有准备好。</p>`;
  });

  return {
    readBook,
    stop() {
      cancelled = true;
      stopReel();
      host.removeEventListener("click", onClick);
      urls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
