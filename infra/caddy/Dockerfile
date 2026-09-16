# 웹(정적) + 리버스 프록시 한 이미지. ARCHITECTURE §7 의 `web` 은 별도 컨테이너가 아니라 이 caddy 의 file_server 다.
# 빌드 컨텍스트는 레포 루트(루트 .dockerignore 가 frontend 소스만 남긴다). 프론트 코드가 바뀌면 이 이미지를 다시 빌드한다.
FROM node:22-alpine AS web
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=web /src/dist /srv
