#!/usr/bin/env python3
"""Local album site. The Ark key stays in ARK_API_KEY and never goes to the browser."""

from __future__ import annotations

import base64
import json
import os
import re
import time
import uuid
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
STYLE = SITE / "assets" / "style-reference.png"
GENERATED = SITE / "generated"
HOST = "127.0.0.1"
PORT = 8765
ARK = "https://ark.cn-beijing.volces.com/api/v3"
VISION = "glm-5-3-flash-260828"
IMAGE = "doubao-seedream-5-0-pro-260628"
MAX_PHOTOS = 8
MAX_PAGES = 6

SESSIONS: dict[str, dict] = {}


def load_env() -> None:
    path = ROOT / ".env"
    if os.environ.get("ARK_API_KEY") or not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def key() -> str:
    load_env()
    value = os.environ.get("ARK_API_KEY", "").strip()
    if not value:
        raise RuntimeError("缺少 ARK_API_KEY")
    return value


def ark(path: str, payload: dict, timeout: int) -> dict:
    req = urllib.request.Request(
        f"{ARK}/{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key()}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"方舟 {error.code}: {detail}") from error


def message_text(data: dict) -> str:
    message = data["choices"][0]["message"]
    content = (message.get("content") or "").strip()
    if content:
        return content
    return (message.get("reasoning_content") or "").strip()


def parse_json(text: str) -> dict:
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    raw = fenced.group(1) if fenced else text
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < start:
        raise RuntimeError("模型没有返回可用的 JSON")
    try:
        return json.loads(raw[start : end + 1])
    except json.JSONDecodeError as error:
        raise RuntimeError("模型没有返回可用的 JSON") from error


def chat(messages: list, tokens: int) -> dict:
    payload = {
        "model": VISION,
        "messages": messages,
        "max_tokens": tokens,
        "reasoning_effort": "low",
    }
    try:
        return parse_json(message_text(ark("chat/completions", payload, 120)))
    except RuntimeError:
        payload.pop("reasoning_effort")
        return parse_json(message_text(ark("chat/completions", payload, 120)))


def data_url_bytes(value: str) -> tuple[bytes, str]:
    match = re.match(r"data:(image/(?:jpeg|png|webp));base64,(.+)", value, re.S)
    if not match:
        raise RuntimeError("只接受 jpg、png、webp")
    return base64.b64decode(match.group(2)), match.group(1)


def read_photo(photo: dict) -> dict:
    blob, mime = data_url_bytes(photo["data"])
    if len(blob) > 8_000_000:
        raise RuntimeError("单张照片太大")
    photo["bytes"] = blob
    photo["mime"] = mime
    photo.pop("data", None)
    url = f"data:{mime};base64,{base64.b64encode(blob).decode()}"
    result = chat(
        [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": url}},
                    {
                        "type": "text",
                        "text": (
                            "阅读这张旅行照片。只根据看得见的东西。"
                            "用 JSON 回答，不要 Markdown："
                            '{"scene":"这是什么地方或时刻","nucleus":"最小的值得记住的关系",'
                            '"anchors":["锚点1","锚点2","锚点3"],'
                            '"uncertain":"一个照片无法确定、可以问旅行者的情节，没有就空字符串",'
                            '"discard":"必须从海报里删掉的杂物"}'
                            "锚点 2 到 3 个，每个不超过 16 个字。不要写风格形容词。"
                        ),
                    },
                ],
            }
        ],
        2000,
    )
    photo["reading"] = {
        "scene": str(result.get("scene", ""))[:80],
        "nucleus": str(result.get("nucleus", ""))[:80],
        "anchors": [str(item)[:40] for item in result.get("anchors", [])][:3],
        "uncertain": str(result.get("uncertain", ""))[:40],
        "discard": str(result.get("discard", ""))[:120],
    }
    return photo["reading"]


READINGS = (
    "下面是同一趟旅行里几张照片的阅读。写一句中文，让人一眼知道这本册子大概是什么。"
    "再写 3 条可以勾选的不确定情节，用来勾起回忆。每条不超过 18 个字。"
    "不要描述版式。JSON："
    '{"sentence":"","checks":[{"id":"c1","text":""},{"id":"c2","text":""},{"id":"c3","text":""}]}'
)


def build_sentence(session: dict) -> dict:
    notes = []
    for photo in session["photos"]:
        reading = photo["reading"]
        notes.append(
            f"id={photo['id']} scene={reading['scene']} nucleus={reading['nucleus']} uncertain={reading['uncertain']}"
        )
    result = chat(
        [{"role": "user", "content": READINGS + "\n" + "\n".join(notes)}],
        2000,
    )
    checks = []
    for item in result.get("checks", [])[:4]:
        text = str(item.get("text", "")).strip()
        if text:
            checks.append({"id": str(item.get("id") or f"c{len(checks)+1}"), "text": text[:24]})
    checks.append(none_check())
    session["sentence"] = str(result.get("sentence", "")).strip()[:80]
    session["checks"] = checks
    return {"sentence": session["sentence"], "checks": checks}


NONE_TEXT = "这几件都没发生"


def none_check() -> dict:
    return {"id": "none", "text": NONE_TEXT}


FALLBACK_COPY = "这一页先停在看见的地方，别的都先不添上去。照片没说完的那一点，先留在这一页里面。"
_ENDERS = "。？！"


def fit_copy(text: str, nucleus: str) -> str:
    del nucleus
    cleaned = str(text).strip()
    enders = sum(cleaned.count(mark) for mark in _ENDERS)
    if (
        "\n" in cleaned
        or re.search(r"[A-Za-z]", cleaned)
        or enders != 2
        or cleaned[-1:] not in _ENDERS
        or not 40 <= len(cleaned) <= 70
    ):
        return FALLBACK_COPY
    return cleaned


def assign_drawing(pages: list[dict]) -> None:
    if not pages:
        return
    pages[0]["kind"] = "cover"
    if len(pages) == 1:
        return
    flagged = [index for index, page in enumerate(pages) if index > 0 and page.get("draw")]
    if len(flagged) == 1:
        chosen = flagged[0]
    elif not flagged:
        chosen = None
    else:
        chosen = max(1, (len(pages) - 1) // 2)
    for index, page in enumerate(pages):
        if index == 0:
            continue
        page["kind"] = "drawing" if index == chosen else "photo"


def english_line(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 .,'’-]", "", value).strip(" .")
    words = cleaned.split()
    if len(words) < 2:
        cleaned = fallback
        words = cleaned.split()
    line = " ".join(words[:8]).upper()
    if not line.endswith("."):
        line += "."
    return line


def _page_fields(photo_id: str, reading: dict, item: dict) -> dict:
    anchors = [str(anchor)[:40] for anchor in (item.get("anchors") or reading["anchors"])][:3]
    return {
        "photoId": photo_id,
        "nucleus": str(item.get("nucleus") or reading["nucleus"])[:80],
        "anchors": anchors,
        "discard": str(item.get("discard") or reading["discard"])[:160],
        "copy": str(item.get("copy", "")),
        "draw": bool(item.get("draw")),
    }


def normalize_story(result: dict, photos: list[dict], sentence: str) -> dict:
    known = {photo["id"]: photo for photo in photos}
    pages = []
    used = set()
    for item in result.get("pages") or []:
        photo_id = str(item.get("photoId", ""))
        if photo_id not in known or photo_id in used:
            continue
        used.add(photo_id)
        pages.append(_page_fields(photo_id, known[photo_id]["reading"], item))
        if len(pages) >= MAX_PAGES:
            break
    if not pages and photos:
        photo = photos[0]
        pages.append(_page_fields(photo["id"], photo["reading"], {}))
    assign_drawing(pages)
    cover = str(sentence).strip()[:80]
    if pages:
        pages[0]["copy"] = cover
    for page in pages[1:]:
        page["copy"] = fit_copy(page["copy"], page["nucleus"])
    for page in pages:
        page.pop("draw", None)
    title = str((result or {}).get("title") or "").strip()[:24] or "一趟旅行"
    return {"title": title, "sentence": cover, "pages": pages}


STORY_RULES = (
    "把这趟旅行排成一篇图文的顺序。只使用给出的照片 id。"
    "不要按文件名排序，按回忆的先后。被否定的情节不要写成一页。"
    "第一句只写这张照片里看得见的。"
    "第二句只写照片里没有的声音、气味、温度或画框外面，不写人做了什么。"
    "人做了什么，只有用户补的那一句里写过，才能写进来。"
    "正文是两句中文，40 到 70 字，恰好两个句末符号。"
    "draw 为 true 的正文页可以没有，至多一页。第一页不要画。"
)


def story_prompt(session: dict, kept: list[str], rejected: list[str], note: str) -> str:
    limit = min(MAX_PAGES, len(session["photos"]))
    photos = "\n".join(
        f"id={photo['id']} nucleus={photo['reading']['nucleus']} "
        f"anchors={photo['reading']['anchors']} discard={photo['reading']['discard']}"
        for photo in session["photos"]
    )
    return (
        f"{STORY_RULES}最多 {limit} 页，可以更少。"
        "JSON："
        '{"title":"中文书名","pages":[{"photoId":"","copy":"","draw":false}]}'
        f"\n已确认的一句话：{session['sentence']}"
        f"\n用户认下的情节：{kept or '没有额外情节'}"
        f"\n用户否定的情节：{rejected or '没有'}"
        f"\n用户补的一句：{note or '没有'}"
        f"\n照片：\n{photos}"
    )


def build_story(session: dict, answers: dict, note: str) -> dict:
    kept = []
    rejected = []
    for item in session["checks"]:
        if item["id"] == "none":
            continue
        (kept if answers.get(item["id"]) else rejected).append(item["text"])
    if answers.get("none"):
        kept.clear()
    result = chat(
        [{"role": "user", "content": story_prompt(session, kept, rejected, note)}],
        2500,
    )
    session["story"] = normalize_story(result, session["photos"], str(session.get("sentence") or ""))
    return session["story"]


def drawing_prompt(page: dict) -> str:
    anchors = "; ".join(str(anchor) for anchor in page["anchors"])
    return (
        "Create ONE original gouache illustration, vertical 3:5, on warm ivory paper. "
        "Image 1 is the only content source. Image 2 is only paint and paper style. "
        f"SEMANTIC NUCLEUS: {page['nucleus']}. "
        f"KEEP THESE ANCHORS: {anchors}. "
        "Fill the frame with the painted scene. Simplify forms into flat painted masses. "
        "No text, letters, captions, or watermarks anywhere in the image. "
        f"LEAVE OUT: {page['discard']}; signs, logos, vehicles, and clutter not named in the anchors. "
        "Redraw as illustration. No photographic pixels, photorealism, or collage."
    )


def poster_error(page: dict) -> str | None:
    if page.get("kind") != "drawing":
        return "这一页不用画"
    return None


def set_drawing(session: dict, index: int) -> dict:
    pages = session["story"]["pages"]
    if len(pages) < 2:
        raise RuntimeError("这一页不用画")
    if index <= 0 or index >= len(pages):
        raise RuntimeError("封面不能改成画")
    for position, page in enumerate(pages):
        page["draw"] = position == index
    assign_drawing(pages)
    return session["story"]


def draw_poster(session: dict, index: int) -> str:
    page = session["story"]["pages"][index]
    photo = next(item for item in session["photos"] if item["id"] == page["photoId"])
    content = f"data:{photo['mime']};base64,{base64.b64encode(photo['bytes']).decode()}"
    style = "data:image/png;base64," + base64.b64encode(STYLE.read_bytes()).decode()
    payload = {
        "model": IMAGE,
        "prompt": drawing_prompt(page),
        "image": [content, style],
        "size": "1536x2560",
        "output_format": "png",
        "response_format": "url",
        "stream": False,
        "watermark": False,
    }
    data = ark("images/generations", payload, 180)
    url = data["data"][0]["url"]
    with urllib.request.urlopen(url, timeout=60) as response:
        blob = response.read()
    GENERATED.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.png"
    (GENERATED / name).write_bytes(blob)
    page["url"] = f"generated/{name}"
    return page["url"]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print("%s - %s" % (self.address_string(), fmt % args))

    def end_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 48_000_000:
            raise RuntimeError("请求太大")
        return json.loads(self.rfile.read(length).decode())

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            load_env()
            self.end_json(200, {"ok": bool(os.environ.get("ARK_API_KEY")), "style": STYLE.exists()})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = self.read_json()
            if self.path == "/api/session":
                session_id = uuid.uuid4().hex
                SESSIONS[session_id] = {"photos": [], "created": time.time()}
                self.end_json(200, {"session": session_id})
                return
            session = SESSIONS.get(str(payload.get("session", "")))
            if session is None:
                raise RuntimeError("这轮制作已经断开，请重新丢入照片")
            if self.path == "/api/photo":
                if len(session["photos"]) >= MAX_PHOTOS:
                    raise RuntimeError("短名单已满")
                photo = {"id": str(payload.get("id") or uuid.uuid4().hex), "data": payload.get("data", "")}
                reading = read_photo(photo)
                session["photos"].append(photo)
                self.end_json(200, {"id": photo["id"], "index": len(session["photos"]), "reading": reading})
                return
            if self.path == "/api/sentence":
                if not session["photos"]:
                    raise RuntimeError("没有可看的照片")
                self.end_json(200, build_sentence(session))
                return
            if self.path == "/api/story":
                answers = payload.get("answers") or {}
                note = str(payload.get("note") or "")[:200]
                self.end_json(200, build_story(session, answers, note))
                return
            if self.path == "/api/drawing":
                index = int(payload.get("index"))
                self.end_json(200, set_drawing(session, index))
                return
            if self.path == "/api/poster":
                index = int(payload.get("index"))
                page = session["story"]["pages"][index]
                error = poster_error(page)
                if error:
                    self.end_json(400, {"error": error})
                    return
                url = draw_poster(session, index)
                page = session["story"]["pages"][index]
                self.end_json(200, {
                    "url": url,
                    "copy": page["copy"],
                    "kind": page["kind"],
                    "title": session["story"]["title"],
                })
                return
            self.end_json(404, {"error": "没有这个步骤"})
        except Exception as error:  # noqa: BLE001
            message = str(error) or "这一步没有完成"
            print("api_error", message[:300])
            self.end_json(400, {"error": message[:300]})


def main() -> None:
    load_env()
    GENERATED.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
