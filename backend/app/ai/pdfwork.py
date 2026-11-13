"""PDF 배치 분석 작업자(README 68) — **별도 프로세스**로만 돈다: `python -I pdfwork.py < 파일 > JSON`.

PDF 에는 「표·문단·제목」이 적혀 있지 않다(좌표에 놓인 글자와 선뿐). pdfplumber 로 선이 그어진 표를 찾고, 나머지 글자는
줄 → 문단으로 묶어 본문 순서(위에서 아래)대로 블록을 낸다. 신뢰불가 입력을 순수 파이썬 파서가 오래 붙잡을 수 있어
(1KB 파일이 수십 초, README 67) 스레드가 아니라 프로세스로 돌려 부모(`extract.pdf_blocks`)가 시간 상한에서 죽인다.
그래서 이 파일은 app 을 import 하지 않는다(설정·DB 없이 혼자 뜬다).

출력: {"pages": 전체 쪽 수, "cut": 상한에서 끊었나, "body": 본문 글자 크기, "blocks": [
  {"t": "p", "text", "size", "bold", "center"} | {"t": "table", "rows": [[{"text", "cs", "rs"}…]…]}]}
종료 코드: 0 정상 · 3 암호 · 그 밖은 형식 오류.

ponytail: 선 없는 표(공백으로 줄 맞춘 것)는 글자로 남는다. 다단(2단 편집)은 줄이 섞일 수 있다. 그림·글자색은 안 싣는다.
스캔본은 글자가 없다(OCR 없음). 필요해지면 find_tables 의 text 전략·열 나누기·page.images 로.
"""

import io
import json
import re
import sys
from collections import Counter

MAX_PAGES = 300
MAX_OUT_CHARS = 400_000  # 부모가 다시 자른다(extract.MAX_CHARS) — 여기는 일을 멈추는 선
MAX_CELLS = 20_000
MAX_MEMORY = 2 * 1024**3  # 주소 공간 상한(리눅스) — 압축 폭탄이 api 컨테이너 메모리를 먹지 않게

# 새 문단을 여는 머리 — 「1.」「가.」「①」「-」「제3조」… 앞줄이 꽉 차 있어도 이어 붙이지 않는다
_MARKER = re.compile(
    r"\s*(\d{1,3}[.)]|\(\d{1,3}\)|[가-하][.)]|\([가-하]\)|[①-⑳㉠-㉻]|[-–•·∙○●◎□■◇◆▶▷※*]|제\s*\d+\s*[조장절항])"
)
_BOLD = re.compile(r"bold|black|heavy|[-_ ]B$|ExtraB|견고딕|헤드라인", re.IGNORECASE)


def _line(row: dict) -> dict | None:
    """extract_text_lines 한 줄 → 글자·자리·크기·굵기. 글은 pdfplumber 가 글자 간격으로 띄어쓰기를 살린 것(공백 글리프가
    없는 PDF 가 많다)을 쓰고, 줄 끝 공백 글리프는 「낱말 사이에서 줄이 바뀌었다」는 표시라 남긴다."""
    chars = [c for c in row["chars"] if c.get("text")]
    text = row["text"].replace("\xa0", " ").strip()
    inked = [c for c in chars if c["text"].strip()]
    if not text or not inked:
        return None
    # 줄 끝에 공백 글리프가 있으면 낱말 사이에서 꺾인 것. 공백 글리프를 아예 안 쓰는 PDF(띄어쓰기가 간격뿐)는 조판기가
    # 낱말 단위로 꺾으므로 역시 띄운다. 공백 글리프를 쓰는데 줄 끝엔 없으면 낱말 중간에서 꺾인 것(브라우저 인쇄) — 붙인다
    if not chars[-1]["text"].strip() or (" " in text and all(c["text"].strip() for c in chars)):
        text += " "
    size = Counter(round(c.get("size") or 0, 1) for c in inked).most_common(1)[0][0]
    return {
        "text": text,
        "x0": min(c["x0"] for c in inked),
        "x1": max(c["x1"] for c in inked),
        "top": min(c["top"] for c in inked),
        "bottom": max(c["bottom"] for c in inked),
        "size": size,
        "bold": all(_BOLD.search(c.get("fontname") or "") for c in inked),
        "n": len(inked),
    }


def _join(a: str, b: str) -> str:
    """두 줄을 한 문단으로 — 앞줄이 공백으로 끝났거나 영문·숫자끼리 만나면 띄우고, 한글이 낱말 중간에서 꺾였으면 붙인다."""
    if a.endswith(" "):
        return a + b
    if a[-1:].isascii() and b[:1].isascii() and a[-1:].isalnum() and b[:1].isalnum():
        return a + " " + b
    return a + b


def _paragraphs(lines: list[dict], width: float) -> list[tuple[float, dict]]:
    """줄들을 문단으로. 앞줄이 오른쪽 끝까지 찼고(자동 줄바꿈), 줄 간격·크기·굵기가 같고, 새 줄이 머리 기호로 시작하지
    않으면 이어 붙인다. 한국 문서는 문단 사이를 띄우지 않는 일이 많아 「앞줄이 짧게 끝났나」가 문단 경계의 주된 단서다."""
    if not lines:
        return []
    # 오른쪽 끝은 「이어진 줄 묶음」마다 잰다 — 쪽 전체로 재면 머리말·쪽 번호가 본문보다 넓어 꽉 찬 줄을 못 알아본다
    run = 0
    for prev, ln in zip([None, *lines], lines, strict=False):
        if prev is not None and not 0 <= ln["top"] - prev["top"] <= 2.6 * (ln["size"] or 10):
            run += 1
        ln["run"] = run
    rights: dict[int, float] = {}
    for ln in lines:
        rights[ln["run"]] = max(rights.get(ln["run"], 0), ln["x1"])
    out: list[tuple[float, dict]] = []
    cur: dict | None = None
    prev: dict | None = None
    for ln in lines:
        size = ln["size"] or 10
        wrapped = (
            cur is not None
            and prev is not None
            and abs(prev["size"] - ln["size"]) <= 0.5
            and prev["bold"] == ln["bold"]
            and prev["run"] == ln["run"]
            and prev["x1"] >= rights[ln["run"]] - 2 * size
            and not _MARKER.match(ln["text"])
        )
        if wrapped:
            cur["text"] = _join(cur["text"], ln["text"])
        else:
            mid = (ln["x0"] + ln["x1"]) / 2
            cur = {
                "t": "p",
                "text": ln["text"],
                "size": ln["size"],
                "bold": ln["bold"],
                # 가운데 정렬 — 줄 가운데가 쪽 가운데고 양쪽이 넉넉히 비어 있다(꽉 찬 줄은 아니다)
                "center": abs(mid - width / 2) <= width * 0.02 and ln["x0"] > width * 0.2,
            }
            out.append((ln["top"], cur))
        prev = ln
    for _, p in out:
        p["text"] = p["text"].strip()
    return out


def _table(page, table) -> dict | None:
    """찾은 표 → 행·칸(colspan·rowspan). 칸은 격자의 사각형이라, 열 시작선·행 시작선을 몇 개 덮는지로 병합을 센다."""
    cells = sorted({c for row in table.rows for c in row.cells if c}, key=lambda c: (c[1], c[0]))
    xs = sorted({round(c[0], 1) for c in cells})
    ys = sorted({round(c[1], 1) for c in cells})
    if len(xs) < 2:
        return (
            None  # 열이 하나뿐인 「표」는 글상자·장식 테두리·색 띠다(실제 파일 확인) — 글자로 둔다
        )
    rows: dict[float, list[dict]] = {y: [] for y in ys}
    for x0, top, x1, bottom in cells:
        try:
            text = page.within_bbox((x0, top, x1, bottom)).extract_text() or ""
        except ValueError:  # 쪽 밖으로 나간 칸
            text = ""
        rows[round(top, 1)].append(
            {
                "text": text.replace("\xa0", " ").strip(),
                "cs": max(1, sum(1 for x in xs if x0 - 0.5 <= x < x1 - 0.5)),
                "rs": max(1, sum(1 for y in ys if top - 0.5 <= y < bottom - 0.5)),
            }
        )
    return {"t": "table", "rows": [rows[y] for y in ys if rows[y]]}


def main() -> int:
    data = sys.stdin.buffer.read()
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY, MAX_MEMORY))
    except (ImportError, ValueError, OSError):
        pass  # 윈도(개발 PC)엔 없다 — 실서버는 리눅스 컨테이너
    import pdfplumber
    from pdfminer.pdfdocument import PDFPasswordIncorrect

    blocks: list[dict] = []
    sizes: Counter = Counter()
    chars = cells = 0
    cut = False
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except PDFPasswordIncorrect:
        return 3
    with pdf:
        total = len(pdf.pages)
        for page in pdf.pages[:MAX_PAGES]:
            items: list[tuple[float, dict]] = []
            boxes = []
            for t in page.find_tables():
                block = _table(page, t)
                if block is None:
                    continue
                boxes.append(t.bbox)
                cells += sum(len(r) for r in block["rows"])
                items.append((t.bbox[1], block))

            def outside(obj, boxes=boxes) -> bool:
                if obj.get("object_type") != "char":
                    return True
                x, y = (obj["x0"] + obj["x1"]) / 2, (obj["top"] + obj["bottom"]) / 2
                return not any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in boxes)

            rest = page.filter(outside) if boxes else page
            raw = rest.extract_text_lines(strip=False, return_chars=True)
            lines = [ln for row in raw if (ln := _line(row))]
            for ln in lines:
                sizes[ln["size"]] += ln["n"]
            # 표 사이에 낀 글자는 표를 건너 이어 붙지 않게, 표 위치로 구간을 나눠 문단을 만든다
            edges = sorted(b[1] for b in boxes)
            groups: dict[int, list[dict]] = {}
            for ln in lines:
                groups.setdefault(sum(1 for e in edges if e <= ln["top"]), []).append(ln)
            for group in groups.values():
                items += _paragraphs(group, float(page.width))
            for _, block in sorted(items, key=lambda it: it[0]):
                blocks.append(block)
                chars += (
                    len(block["text"])
                    if block["t"] == "p"
                    else sum(len(c["text"]) for r in block["rows"] for c in r)
                )
            page.close()  # 쪽마다 캐시를 비운다 — 300쪽을 다 쥐고 있지 않게
            if chars > MAX_OUT_CHARS or cells > MAX_CELLS:
                cut = True
                break
        cut = cut or total > MAX_PAGES
    body = sizes.most_common(1)[0][0] if sizes else 0
    json.dump({"pages": total, "cut": cut, "body": body, "blocks": blocks}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
