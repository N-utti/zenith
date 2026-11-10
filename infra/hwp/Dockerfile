# 구형 .hwp(HWP 5 바이너리) → XML 변환기. pyhwp(AGPL-3.0)를 api 와 다른 컨테이너·프로세스에 두어
# 라이선스 경계를 네트워크로 긋는다(backend/README 65). api 만 compose 망 안에서 hwp:8080 으로 부른다.
FROM python:3.11-slim

# 전이 의존성까지 requirements.txt 로 고정(리뷰). lxml 은 hwp5proc 의 XML 직렬화에.
COPY requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt \
    && useradd --system --no-create-home hwp

COPY server.py /srv/server.py
USER hwp
EXPOSE 8080
CMD ["python", "-I", "/srv/server.py"]
