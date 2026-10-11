import { FADE_MS, FRAME, coverSize, exportSize, isLegacy, layoutCopy, placeImage, reelCues, trackedWidth, videoLead } from "./essay.js";

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

const PAGE_BOX = exportSize("page");
const COVER_BOX = exportSize("cover");
if (COVER_BOX.width !== coverSize(FRAME.width, FRAME.height).width || COVER_BOX.height !== coverSize(FRAME.width, FRAME.height).height) {
  throw new Error("封面尺寸对不上");
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

function paintEssay(ctx, image, page, size) {
  const { width, height } = size;
  ctx.fillStyle = "#f3eedf";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (isLegacy(page)) {
    const scale = Math.min(width / image.width, height / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return;
  }
  const band = Math.round(FRAME.imageHeight * height / FRAME.height);
  const placed = placeImage(image.width, image.height, width, band);
  ctx.drawImage(image, placed.sx, placed.sy, placed.sw, placed.sh, placed.dx, placed.dy, placed.dw, placed.dh);
  const blocks = page.kind === "cover"
    ? [page.title, page.sentence].filter((item) => String(item || "").trim())
    : [page.copy].filter((item) => String(item || "").trim());
  if (!blocks.length) return;
  const scale = width / 420;
  const top = band + 16 * scale;
  const bottom = height - 12 * scale;
  const typeface = `"Songti SC", "Iowan Old Style", Palatino, serif`;
  const laid = layoutCopy(blocks, {
    width,
    top,
    bottom,
    scale,
    ranks: page.kind === "cover" ? [28, 22] : undefined,
    measure: (text, fontSize, blockIndex) => {
      ctx.font = `${fontSize}px ${typeface}`;
      if (page.kind === "cover" && blockIndex === 0) {
        return trackedWidth(text, fontSize, (char) => ctx.measureText(char).width, 0.12);
      }
      return ctx.measureText(text).width;
    },
  });
  ctx.textBaseline = "top";
  let y = top;
  laid.lines.forEach((line, index) => {
    const fontSize = laid.lineSizes[index];
    const lineHeight = fontSize * 1.55;
    if (line) {
      const title = page.kind === "cover" && laid.lineBlocks[index] === 0;
      ctx.fillStyle = page.kind === "cover" && laid.lineBlocks[index] > 0 ? "#6f6e64" : "#282923";
      ctx.font = `${fontSize}px ${typeface}`;
      if (title) {
        let x = 22 * scale;
        [...line].forEach((char, glyph) => {
          ctx.fillText(char, x, y);
          x += ctx.measureText(char).width;
          if (glyph < [...line].length - 1) x += 0.12 * fontSize;
        });
      } else {
        ctx.fillText(line, 22 * scale, y);
      }
    }
    y += line ? lineHeight : lineHeight * 0.4;
  });
}

function compose(image, page, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  paintEssay(canvas.getContext("2d", { alpha: false }), image, page, size);
  return canvas;
}

async function prepare(book, urls, cancelled) {
  const stem = fileStem(book.title);
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
    const framed = await jpeg(compose(image, page, PAGE_BOX));
    const preview = track(urls, framed);
    xhs.push({ blob: framed, name: `${stem}-小红书-${n}.jpg`, preview });
    if (index === 0) {
      const coverBlob = await jpeg(compose(image, page, COVER_BOX));
      cover = {
        blob: coverBlob,
        name: `${stem}-朋友圈封面.jpg`,
        preview: track(urls, coverBlob),
      };
    } else {
      squares.push({ blob: framed, name: `${stem}-朋友圈-${n}.jpg`, preview });
    }
    image.close?.();
  }
  return { squares, xhs, cover, caption: captionOf(book) };
}

export function handoffShell() {
  return `
    <section class="handoff">
      <div class="format-row">
        <div class="formats" role="tablist" aria-label="发出去的形式">
          <button type="button" role="tab" data-format="moments" aria-selected="false">朋友圈</button>
          <button type="button" role="tab" data-format="xhs" aria-selected="false">小红书</button>
          <button type="button" role="tab" data-format="video" aria-selected="false">视频</button>
        </div>
      </div>
      <div class="stage" hidden></div>
    </section>`;
}

export function momentsMarkup(pack) {
  const files = [pack.cover, ...(pack.squares || [])].filter(Boolean);
  const shots = files.map((file, index) => `
    <button class="shot" type="button" data-look="${index}" aria-label="${escape(file.name)}"><img src="${escape(file.preview)}" alt=""></button>`).join("");
  return `
    <div class="moments-stage">
      <img class="moments-hero" data-hero src="${escape(files[0]?.preview || "")}" alt="">
      <div class="grid-preview" data-count="${files.length}">${shots}</div>
      <div class="actions"><button class="primary" type="button" data-set="moments">保存这一套</button></div>
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
        <img src="${page.preview}" alt="">
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

function videoMarkup(book, frames) {
  const items = frames?.length ? frames : book.pages;
  const reel = items.map((page, index) => `<img src="${page.preview || page.url}" alt="" class="${index === 0 ? "on" : ""}">`).join("");
  return `
    <div class="reel" data-reel>${reel}</div>
    <div class="actions">
      <button class="primary" type="button" data-video="1">保存视频</button>
      <p class="lead">${escape(videoLead(book.pages))}</p>
    </div>
    <p class="error" data-video-error hidden>这台浏览器做不成视频。画面可以在这里看。</p>`;
}

function filesFor(pack, key) {
  if (key === "moments") return [pack.cover, ...(pack.squares || [])].filter(Boolean);
  if (key === "squares") return pack.squares;
  return pack.xhs;
}

function zipName(key, title) {
  const stem = fileStem(title);
  if (key === "moments") return `${stem}-朋友圈.zip`;
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

async function recordReel(pages, title) {
  const size = exportSize("page");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const frames = [];
  for (const page of pages) {
    const response = await fetch(page.url);
    if (!response.ok) throw new Error("这一页读不出来");
    const bitmap = await createImageBitmap(await response.blob());
    frames.push(compose(bitmap, page, size));
    bitmap.close?.();
  }
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
  if (!mime || typeof canvas.captureStream !== "function") throw new Error("unsupported");
  const { fade, cues, total } = reelCues(pages);
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
    let index = cues.length - 1;
    for (let i = 0; i < cues.length - 1; i += 1) {
      if (time < cues[i + 1].start) {
        index = i;
        break;
      }
    }
    const local = time - cues[index].start;
    ctx.globalAlpha = 1;
    ctx.drawImage(frames[index], 0, 0);
    if (index < pages.length - 1 && local > cues[index].hold) {
      ctx.globalAlpha = Math.min(1, (local - cues[index].hold) / fade);
      ctx.drawImage(frames[index + 1], 0, 0);
      ctx.globalAlpha = 1;
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
  frames.forEach((frame) => frame.getContext("2d")?.clearRect?.(0, 0, frame.width, frame.height));
  stream.getTracks().forEach((track) => track.stop());
  const extension = mime.includes("mp4") ? "mp4" : "webm";
  return { blob: new Blob(chunks, { type: mime }), name: `${fileStem(title)}-视频.${extension}` };
}

export function mountHandoff(host, book, hooks = {}) {
  let cancelled = false;
  let pack = null;
  let format = "";
  let xhsIndex = 0;
  let reelTimer = 0;
  const urls = [];
  host.innerHTML = handoffShell();
  const stage = host.querySelector(".stage");

  function stopReel() {
    window.clearTimeout(reelTimer);
    reelTimer = 0;
  }

  function startReel() {
    stopReel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = stage.querySelector("[data-reel]");
    if (!frame) return;
    const images = [...frame.querySelectorAll("img")];
    if (images.length < 2) return;
    const { cues } = reelCues(book.pages);
    let index = 0;
    const arm = () => {
      const hold = (cues[index]?.hold ?? 3) * 1000;
      reelTimer = window.setTimeout(() => {
        const next = (index + 1) % images.length;
        images[index].classList.remove("on");
        images[next].classList.add("on");
        index = next;
        reelTimer = window.setTimeout(arm, FADE_MS);
      }, hold);
    };
    arm();
  }

  function markTabs() {
    host.querySelectorAll("[data-format]").forEach((button) => {
      button.setAttribute("aria-selected", button.dataset.format === format ? "true" : "false");
    });
  }

  function renderStage() {
    if (!format) {
      stopReel();
      stage.hidden = true;
      stage.innerHTML = "";
      return;
    }
    stage.hidden = false;
    if (format === "video") {
      stage.innerHTML = videoMarkup(book, pack?.xhs);
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
      if (format === button.dataset.format) {
        format = "";
        markTabs();
        renderStage();
        hooks.openBook?.();
        return;
      }
      format = button.dataset.format;
      hooks.closeBook?.();
      markTabs();
      renderStage();
      return;
    }
    if (button.dataset.look != null) {
      if (!pack) return;
      const file = filesFor(pack, "moments")[Number(button.dataset.look)];
      const hero = stage.querySelector("[data-hero]");
      if (hero && file) hero.src = file.preview;
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
    if (button.dataset.set) {
      files = filesFor(pack, button.dataset.set);
      name = files.length === 1 ? files[0].name : zipName(button.dataset.set, book.title);
    }
    if (!files?.[0]) return;
    button.disabled = true;
    const outcome = await give(files, name);
    button.disabled = false;
    if (outcome !== "abort") flash(button, "已保存");
  };

  host.addEventListener("click", onClick);
  prepare(book, urls, () => cancelled).then((result) => {
    if (cancelled) return;
    pack = result;
    if (format) renderStage();
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
