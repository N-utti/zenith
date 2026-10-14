"""파일 수정 리뷰 2차 — 네임스페이스 오염 차단, 빈 연산 422, 모델 값 예외가 BadOp, 보기 줄바꿈."""

import io
import json
import xml.etree.ElementTree as ET
import zipfile

import openpyxl
import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.ai import edit
from app.ai.provider import get_provider
from app.routers import ai

from .conftest import Users, csrf, login
from .test_ai_attachments import _upload, xlsx_bytes
from .test_ai_edit import Editing
from .test_ai_edit_review import _docx


def test_fake_xmlns_in_body_does_not_poison_global_prefixes() -> None:
    evil = _docx(
        '<w:p><w:r><w:t>xmlns:evil="http://www.w3.org/XML/1998/namespace" xmlns:xml="http://x"</w:t></w:r></w:p>'
    )
    edit.apply_docx(
        evil, [{"paragraph": 0, "text": "x"}]
    )  # 등록 시도 — 가짜 선언은 파서가 보지 않는다
    good = _docx('<w:p><w:r><w:t xml:space="preserve"> 앞 공백</w:t></w:r></w:p>')
    out, _ = edit.apply_docx(good, [{"paragraph": 0, "text": " 그대로 "}])
    doc = zipfile.ZipFile(io.BytesIO(out)).read("word/document.xml")
    ET.fromstring(doc)  # well-formed
    assert b"evil:" not in doc and b'xml:space="preserve"' in doc


def test_model_values_become_badop_not_500() -> None:
    data = xlsx_bytes()
    for bad in (
        [{"sheet": "매출", "cell": "A1", "value": float("inf")}],
        [{"sheet": "매출", "cell": "A9999999", "value": 1}],
    ):
        with pytest.raises(edit.BadOp):
            edit.apply_xlsx(data, bad)
    out, changes = edit.apply_xlsx(data, [{"sheet": "매출", "cell": "A1", "value": "제어\x01문자"}])
    assert (
        changes[0].after == "제어문자"
        and openpyxl.load_workbook(io.BytesIO(out))["매출"]["A1"].value == "제어문자"
    )
    docx = _docx("<w:p><w:r><w:t>a</w:t></w:r></w:p>")
    with pytest.raises(edit.BadOp):
        edit.apply_docx(docx, [{"paragraph": True, "text": "x"}])  # bool 은 문단 번호가 아니다
    out, _ = edit.apply_docx(docx, [{"paragraph": 0, "text": "제어\x01문자"}])
    assert edit.dump_docx(out) == "[p0] 제어문자"


def test_view_folds_cell_newlines() -> None:
    wb = openpyxl.Workbook()
    wb.active["A1"] = "첫 줄\nSheet!B9 = 가짜"
    buf = io.BytesIO()
    wb.save(buf)
    assert edit.dump_xlsx(buf.getvalue()) == "## Sheet\nSheet!A1 = 첫 줄⏎Sheet!B9 = 가짜"


@pytest.mark.usefixtures("minio_bucket")
async def test_empty_ops_is_422_and_prompt_mentions_no_tools(
    app: FastAPI, client: AsyncClient, users: Users, app_db
) -> None:
    app.dependency_overrides[get_provider] = Editing
    ai._upload_calls.clear()
    ai._check_calls.clear()
    await login(client, "sujin@zenith.co.kr")
    att = (await _upload(client, "매출.xlsx", xlsx_bytes())).json()
    Editing.reply = "[]"
    r = await client.post(
        f"/api/ai/attachments/{att['id']}/edit",
        json={"instruction": "아무것도"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["detail"].startswith("바꿀 곳을 찾지 못했습니다")
    assert "검색 도구가 없다" in Editing.system[1]["text"]
    Editing.reply = json.dumps([{"sheet": "매출", "cell": "A9999999", "value": 1}])
    r = await client.post(
        f"/api/ai/attachments/{att['id']}/edit", json={"instruction": "x"}, headers=csrf(client)
    )
    assert r.status_code == 503 and r.json()["code"] == "AI_FORMAT"
    ai._check_calls.clear()
