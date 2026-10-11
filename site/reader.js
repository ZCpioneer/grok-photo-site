export function mountBook(host, pages) {
  const mobile = () => matchMedia("(max-width: 760px)").matches;
  let turned = 0;
  let mobilePage = 0;
  let locked = false;
  let timer = 0;
  host.innerHTML = `
    <section class="reading-area" aria-label="翻页相册">
      <button class="round prev" type="button" aria-label="上一页">←</button>
      <div class="book-wrap"><div class="book"></div></div>
      <button class="round next" type="button" aria-label="下一页">→</button>
    </section>
    <div class="status"><span class="label"></span><span id="counter"></span></div>`;
  const book = host.querySelector(".book");
  const prev = host.querySelector(".prev");
  const next = host.querySelector(".next");
  const label = host.querySelector(".label");
  const counter = host.querySelector("#counter");
  book.innerHTML = Array.from({ length: Math.ceil(pages.length / 2) }, (_, index) => {
    const faces = [0, 1].map((side) => {
      const page = pages[index * 2 + side];
      const inner = page
        ? `<article class="page"><img src="${page.url}" alt="${escape(page.line)}" draggable="false"></article>`
        : `<article class="page"></article>`;
      return `<div class="face ${side ? "back" : "front"}">${inner}</div>`;
    }).join("");
    return `<div class="sheet" data-sheet="${index}">${faces}</div>`;
  }).join("");
  const sheets = [...book.querySelectorAll(".sheet")];

  function render(animating = -1) {
    const narrow = mobile();
    const count = sheets.length;
    book.classList.toggle("open", !narrow && turned > 0 && turned < count);
    book.classList.toggle("ended", !narrow && turned === count);
    sheets.forEach((sheet, index) => {
      sheet.classList.toggle("flipped", narrow ? index < Math.floor(mobilePage / 2) : index < turned);
      sheet.classList.toggle("mobile-back", narrow && index === Math.floor(mobilePage / 2) && mobilePage % 2 === 1);
      sheet.style.zIndex = String(index === animating ? 100 : (narrow ? (index === Math.floor(mobilePage / 2) ? 50 : 0) : (index < turned ? index + 1 : 30 - index)));
    });
    let active;
    if (narrow) active = [mobilePage];
    else if (turned === 0 || turned === count) active = [turned === 0 ? 0 : pages.length - 1];
    else active = [turned * 2 - 1, turned * 2].filter((index) => index < pages.length);
    label.textContent = active.map((index) => pages[index].line).join("  ·  ");
    counter.textContent = `${active.map((index) => String(index + 1).padStart(2, "0")).join("–")} / ${String(pages.length).padStart(2, "0")}`;
    prev.disabled = narrow ? mobilePage === 0 : turned === 0;
    next.disabled = narrow ? mobilePage === pages.length - 1 : turned === count;
  }

  function flip(direction) {
    if (locked || !pages.length) return;
    if (mobile()) {
      const dest = Math.max(0, Math.min(pages.length - 1, mobilePage + direction));
      if (dest === mobilePage) return;
      mobilePage = dest;
      turned = Math.min(sheets.length, Math.ceil(mobilePage / 2));
      render();
      return;
    }
    const dest = Math.max(0, Math.min(sheets.length, turned + direction));
    if (dest === turned) return;
    const moving = direction > 0 ? turned : turned - 1;
    turned = dest;
    mobilePage = Math.min(pages.length - 1, Math.max(0, turned * 2 - 1));
    locked = true;
    render(moving);
    timer = window.setTimeout(() => {
      locked = false;
      render();
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1020);
  }

  const onKey = (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    flip(event.key === "ArrowRight" ? 1 : -1);
  };
  let down = null;
  let suppress = false;
  prev.addEventListener("click", () => flip(-1));
  next.addEventListener("click", () => flip(1));
  book.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY }; });
  book.addEventListener("pointerup", (event) => {
    if (!down) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      suppress = true;
      flip(dx < 0 ? 1 : -1);
      window.setTimeout(() => { suppress = false; }, 120);
    }
  });
  book.addEventListener("click", (event) => {
    if (suppress) return;
    if (mobile()) {
      const rect = book.getBoundingClientRect();
      flip(event.clientX - rect.left < rect.width * 0.3 ? -1 : 1);
      return;
    }
    const sheet = event.target.closest(".sheet");
    if (sheet) flip(Number(sheet.dataset.sheet) < turned ? -1 : 1);
  });
  const onResize = () => render();
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  render();
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  };
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
