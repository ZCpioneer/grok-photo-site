import { choosePhotos } from "./filter.js";
import { mountHandoff } from "./handoff.js";
import { essayMarkup, readingShell, sampleBook as SAMPLE } from "./essay.js";

const app = document.querySelector("#app");
const hint = document.querySelector("#hint");
let cleanup = () => {};
let objectUrls = [];
let viewToken = 0;

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function revokeUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

function alive(token) {
  return token === viewToken;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("shijing", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("albums")) db.createObjectStore("albums", { keyPath: "id" });
      if (!db.objectStoreNames.contains("posters")) db.createObjectStore("posters");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(db, names, mode) {
  const tx = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("书架没有写成"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("书架没有写成"));
    };
  });
  return { tx, done };
}

async function listAlbums() {
  const db = await openDb();
  const { tx, done } = transaction(db, ["albums"], "readonly");
  const albums = await new Promise((resolve, reject) => {
    const request = tx.objectStore("albums").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  await done;
  return albums;
}

async function readAlbum(id) {
  const db = await openDb();
  const { tx, done } = transaction(db, ["albums", "posters"], "readonly");
  const album = await new Promise((resolve, reject) => {
    const albumRequest = tx.objectStore("albums").get(id);
    albumRequest.onerror = () => reject(albumRequest.error);
    albumRequest.onsuccess = () => {
      const stored = albumRequest.result;
      if (!stored) {
        resolve(null);
        return;
      }
      if (!stored.pages.length) {
        resolve({ ...stored, pages: [] });
        return;
      }
      const posters = tx.objectStore("posters");
      const pages = [];
      let pending = stored.pages.length;
      stored.pages.forEach((page, index) => {
        const posterRequest = posters.get(page.posterId);
        posterRequest.onerror = () => reject(posterRequest.error);
        posterRequest.onsuccess = () => {
          pages[index] = { line: page.line, blob: posterRequest.result };
          pending -= 1;
          if (pending === 0) resolve({ ...stored, pages });
        };
      });
    };
  });
  await done;
  return album;
}

async function saveAlbum(album, blobs) {
  const db = await openDb();
  const { tx, done } = transaction(db, ["albums", "posters"], "readwrite");
  const posters = tx.objectStore("posters");
  blobs.forEach((blob, index) => posters.put(blob, album.pages[index].posterId));
  tx.objectStore("albums").put(album);
  await done;
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "这一步没有完成");
  return data;
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function setHint(text) {
  hint.textContent = text;
}

function render(html) {
  cleanup();
  cleanup = () => {};
  revokeUrls();
  app.innerHTML = html;
}

async function showShelf(token) {
  setHint("做完的册子留在这台浏览器里");
  let albums = [];
  let warning = "";
  try {
    albums = await listAlbums();
  } catch {
    warning = "这台浏览器暂时存不下新册子。试册仍可以翻。";
  }
  if (!alive(token)) return;
  let health = { ok: true };
  try {
    health = await fetch("/api/health").then((response) => response.json());
  } catch {
    health = { ok: false, down: true };
  }
  if (!alive(token)) return;
  albums.sort((a, b) => b.created - a.created);
  const books = [SAMPLE, ...albums];
  const cards = books.map((book) => {
    const cover = book.sample ? book.pages[0].url : "";
    const note = book.sample ? "效果样张" : `${book.pages.length} 页`;
    return `<button class="book-link" type="button" data-id="${escape(book.id)}" data-cover="${book.sample ? "" : "1"}">
      <span class="cover">${cover ? `<img src="${cover}" alt="">` : `<img alt="" data-poster="${escape(book.pages[0]?.posterId || "")}">`}</span>
      <strong>${escape(book.title)}</strong>
      <small>${note}</small>
    </button>`;
  }).join("");
  const healthNote = health.down
    ? `<p class="error">本机服务没开。书架可以看，新的一册要等服务起来。</p>`
    : health.ok
      ? ""
      : `<p class="error">服务开着，但还没有接上画画的钥匙。已有的册子仍可以翻。</p>`;
  render(`
    <div class="shelf-head">
      <div>
        <h1>书架</h1>
        <p class="lead">一次丢进一趟旅行的照片。先确认一句故事，再画成纸刊。</p>
      </div>
      <a class="primary" href="#/make">做一本</a>
    </div>
    ${healthNote}
    ${warning ? `<p class="error">${warning}</p>` : ""}
    <div class="shelf">${cards}</div>
    <p class="lead">试册用的是公开图片，不是一趟真实旅行。</p>`);
  if (!alive(token)) return;
  const stored = albums.filter((book) => book.pages[0]);
  if (stored.length) {
    const db = await openDb();
    await Promise.all(stored.map((book) => new Promise((resolve) => {
      const tx = db.transaction("posters", "readonly");
      const request = tx.objectStore("posters").get(book.pages[0].posterId);
      request.onsuccess = () => {
        const image = app.querySelector(`[data-poster="${CSS.escape(book.pages[0].posterId)}"]`);
        if (request.result && image && alive(token)) {
          const url = URL.createObjectURL(request.result);
          objectUrls.push(url);
          image.src = url;
        }
        resolve();
      };
      request.onerror = () => resolve();
    })));
    db.close();
  }
  app.querySelectorAll(".book-link").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = `#/read/${encodeURIComponent(button.dataset.id)}`;
    });
  });
}

function showMissing() {
  setHint("这本不在这台浏览器里");
  render(`
    <div class="card">
      <h1>没有这本册子</h1>
      <p class="lead">它可能在另一台浏览器里，或者还没有画完。</p>
      <div class="actions"><a class="primary" href="#/">回书架</a></div>
    </div>`);
}

function showReading(pages, meta) {
  setHint("先读这篇");
  render(readingShell());
  const viewPages = pages.map((page) => {
    const view = {
      ...page,
      title: page.title || meta.title || "",
      sentence: page.sentence ?? meta.sentence ?? "",
    };
    if (!page.blob) return view;
    const url = URL.createObjectURL(page.blob);
    objectUrls.push(url);
    return { ...view, url };
  });
  const essay = app.querySelector("#essay");
  let index = 0;
  const paint = () => {
    const last = viewPages.length - 1;
    essay.innerHTML = `
      <button class="essay-nav prev" type="button" data-step="-1" ${index === 0 ? "disabled" : ""}>上一页</button>
      <div class="essay-frame">${viewPages.length ? essayMarkup(viewPages[index]) : ""}</div>
      <button class="essay-nav next" type="button" data-step="1" ${index >= last ? "disabled" : ""}>下一页</button>`;
  };
  const go = (step) => {
    const next = index + step;
    if (next < 0 || next >= viewPages.length) return;
    index = next;
    paint();
  };
  essay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (button) {
      if (!button.disabled) go(Number(button.dataset.step));
      return;
    }
    const frame = essay.querySelector(".essay-frame");
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    go(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
  });
  paint();
  const handoff = mountHandoff(app.querySelector("#handoff"), { ...meta, pages: viewPages });
  cleanup = () => handoff.stop();
}

async function showBook(token, id) {
  setHint("点一个名字，看发出去的样子");
  if (id === SAMPLE.id) {
    showReading(SAMPLE.pages, { title: SAMPLE.title, sentence: SAMPLE.sentence, pages: SAMPLE.pages });
    return;
  }
  let album;
  try {
    album = await readAlbum(id);
  } catch {
    if (alive(token)) showMissing();
    return;
  }
  if (!alive(token)) return;
  if (!album || !album.pages.length) {
    showMissing();
    return;
  }
  showReading(album.pages, { title: album.title, sentence: album.sentence || "" });
}

function waitForChoice(root) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const onClick = (event) => {
      const button = event.target.closest("[data-choice]");
      if (!button) return;
      finish(button.dataset.choice);
    };
    root.addEventListener("click", onClick);
    const previous = cleanup;
    cleanup = () => {
      root.removeEventListener("click", onClick);
      finish(null);
      previous();
    };
  });
}

async function showMake(token) {
  setHint("先确认故事，再画");
  render(`
    <div class="card">
      <h1>做一本</h1>
      <p class="lead">一次丢进这一趟的照片。模糊和几乎重复的会先在这台电脑上去掉，只把少数几张送去看。这里不会铺开照片墙。</p>
      <label class="drop" id="drop">
        <strong>把照片拖到这里</strong>
        <span>也可以点这里选。只要 jpg、png、webp。</span>
        <input id="files" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
      </label>
      <p class="error" id="make-error" hidden></p>
    </div>`);
  const drop = app.querySelector("#drop");
  const input = app.querySelector("#files");
  const error = app.querySelector("#make-error");
  let started = false;
  const fail = (message) => {
    started = false;
    input.disabled = false;
    error.hidden = false;
    error.textContent = message;
    drop.innerHTML = `<strong>把照片拖到这里</strong><span>也可以点这里选。只要 jpg、png、webp。</span>`;
    drop.append(input);
  };
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    begin(event.dataTransfer.files);
  });
  input.addEventListener("change", () => begin(input.files));

  async function begin(fileList) {
    if (started || !alive(token) || !fileList?.length) return;
    started = true;
    input.disabled = true;
    error.hidden = true;
    drop.innerHTML = "<strong>正在这台电脑上挑照片</strong><span>模糊的、几乎一样的会先放下。</span>";
    let chosen;
    try {
      chosen = await choosePhotos(fileList);
    } catch (reason) {
      if (alive(token)) fail(reason.message || "这些照片读不了");
      return;
    }
    if (!alive(token)) return;
    if (!chosen.kept.length) {
      fail(chosen.skipped.length ? "这些文件读不了。请换 jpg、png 或 webp。" : "没有留下可以看的照片。");
      return;
    }
    let session;
    try {
      session = (await post("/api/session", {})).session;
    } catch (reason) {
      if (alive(token)) fail(reason.message);
      return;
    }
    for (let index = 0; index < chosen.kept.length; index += 1) {
      if (!alive(token)) return;
      drop.innerHTML = `<strong>正在看第 ${index + 1} 张</strong><span>共 ${chosen.kept.length} 张。还不会画。</span>`;
      try {
        const data = await dataUrl(chosen.kept[index].blob);
        await post("/api/photo", { session, id: chosen.kept[index].id, data });
      } catch (reason) {
        if (alive(token)) fail(reason.message);
        return;
      }
    }
    if (!alive(token)) return;
    drop.innerHTML = "<strong>正在收成一句话</strong><span>看完才给你确认。</span>";
    let draft;
    try {
      draft = await post("/api/sentence", { session });
    } catch (reason) {
      if (alive(token)) fail(reason.message);
      return;
    }
    if (alive(token)) await confirmSentence(token, session, draft, chosen);
  }
}

async function confirmSentence(token, session, draft, chosen) {
  if (!alive(token)) return;
  const checks = draft.checks.map((item) => `
    <label class="check">
      <input type="checkbox" name="check" value="${escape(item.id)}">
      <span>${escape(item.text)}</span>
    </label>`).join("");
  render(`
    <div class="card">
      <p class="kicker">这本册子大概是</p>
      <p class="sentence">${escape(draft.sentence || "这趟旅行还没有被说成一句话。")}</p>
      <p class="lead">这句话对，就可以按它走。说不准的地方勾上；选「没有」也是回答。想到的可以补一句。</p>
      <p class="kicker">这几件，有的话勾上</p>
      ${checks}
      <input class="note" id="note" maxlength="200" placeholder="补一句你记得的，也可以空着">
      <p class="lead">留下 ${chosen.kept.length} 张，其余 ${chosen.dropped} 张已在本机放下。</p>
      <p class="error" id="make-error" hidden></p>
      <div class="actions">
        <button class="primary" type="button" id="to-story">按这些重写故事</button>
        <a class="quiet" href="#/">放回书架</a>
      </div>
    </div>`);
  const boxes = [...app.querySelectorAll('input[name="check"]')];
  boxes.forEach((box) => {
    box.addEventListener("change", () => {
      if (box.value === "none" && box.checked) {
        boxes.forEach((other) => {
          if (other !== box) other.checked = false;
        });
      } else if (box.checked) {
        const none = boxes.find((other) => other.value === "none");
        if (none) none.checked = false;
      }
    });
  });
  app.querySelector("#to-story").addEventListener("click", async () => {
    const button = app.querySelector("#to-story");
    button.disabled = true;
    const answers = {};
    boxes.forEach((box) => {
      answers[box.value] = box.checked;
    });
    const note = app.querySelector("#note").value.trim();
    try {
      const story = await post("/api/story", { session, answers, note });
      if (alive(token)) await confirmStory(token, session, story, () => confirmSentence(token, session, draft, chosen));
    } catch (reason) {
      if (!alive(token)) return;
      const error = app.querySelector("#make-error");
      error.hidden = false;
      error.textContent = reason.message;
      button.disabled = false;
    }
  });
}

async function confirmStory(token, session, story, back) {
  if (!alive(token)) return;
  const items = story.pages.map((page) => `<li>${escape(page.nucleus)}<small>${escape(page.line)}</small></li>`).join("");
  render(`
    <div class="card">
      <p class="kicker">${escape(story.title)}</p>
      <p class="lead">相册会按这个顺序走。到这里还没有画册。点头之后才一页页画，一册最多六页。</p>
      <ol class="story">${items}</ol>
      <p class="error" id="make-error" hidden></p>
      <div class="actions">
        <button class="primary" type="button" data-choice="draw">就按这个画</button>
        <button class="quiet" type="button" data-choice="back">回到勾选</button>
      </div>
    </div>`);
  const choice = await waitForChoice(app);
  if (!alive(token) || !choice) return;
  if (choice === "back") {
    await back();
    return;
  }
  await drawBook(token, session, story);
}

async function drawOne(session, index) {
  const result = await post("/api/poster", { session, index });
  const response = await fetch(result.url);
  if (!response.ok) throw new Error("这一页画完了，但没有存下来");
  const blob = await response.blob();
  return { line: result.line, title: result.title, blob };
}

async function drawBook(token, session, story) {
  const drawn = [];
  for (let index = 0; index < story.pages.length; index += 1) {
    let page = null;
    while (!page && alive(token)) {
      render(`
        <div class="card">
          <p class="kicker">${escape(story.title)}</p>
          <p class="sentence">正在画第 ${index + 1} 页</p>
          <p class="lead">共 ${story.pages.length} 页。画的时候先留在这一页。一页要一会儿。</p>
          <p class="lead">已完成 ${drawn.length} 页。</p>
        </div>`);
      try {
        page = await drawOne(session, index);
      } catch (reason) {
        if (!alive(token)) return;
        render(`
          <div class="card">
            <p class="kicker">${escape(story.title)}</p>
            <p class="sentence">第 ${index + 1} 页没有画成</p>
            <p class="error">${escape(reason.message)}</p>
            <p class="lead">这一页可以再试。跳过的话，册子用已经画成的页。</p>
            <div class="actions">
              <button class="primary" type="button" data-choice="retry">再画这一页</button>
              <button class="quiet" type="button" data-choice="skip">跳过这一页</button>
            </div>
          </div>`);
        const choice = await waitForChoice(app);
        if (!alive(token) || !choice) return;
        if (choice === "skip") break;
      }
    }
    if (page) drawn.push(page);
  }
  if (!alive(token)) return;
  if (!drawn.length) {
    render(`
      <div class="card">
        <h1>这本还没有页</h1>
        <p class="lead">一页都没有留下来，所以没有放上书架。</p>
        <div class="actions"><a class="primary" href="#/make">重新丢照片</a></div>
      </div>`);
    return;
  }
  const album = {
    id: crypto.randomUUID(),
    title: story.title || "一趟旅行",
    created: Date.now(),
    sentence: story.sentence || "",
    pages: drawn.map((page) => ({ line: page.line, posterId: crypto.randomUUID() })),
  };
  try {
    await saveAlbum(album, drawn.map((page) => page.blob));
  } catch {
    if (!alive(token)) return;
    render(`
      <div class="card">
        <h1>册子画好了，但没有放进书架</h1>
        <p class="error">这台浏览器拒绝保存图片。</p>
        <div class="actions"><a class="primary" href="#/">回书架</a></div>
      </div>`);
    return;
  }
  if (!alive(token)) return;
  location.hash = `#/read/${encodeURIComponent(album.id)}`;
}

async function route() {
  const token = ++viewToken;
  cleanup();
  cleanup = () => {};
  const hash = location.hash || "#/";
  if (hash === "#/" || hash === "#" || hash === "") {
    await showShelf(token);
    return;
  }
  if (hash === "#/make") {
    await showMake(token);
    return;
  }
  const matched = hash.match(/^#\/read\/([^/]+)$/);
  if (matched) {
    await showBook(token, decodeURIComponent(matched[1]));
    return;
  }
  location.hash = "#/";
}

window.addEventListener("hashchange", () => {
  route();
});
route();
