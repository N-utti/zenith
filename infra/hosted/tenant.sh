#!/usr/bin/env bash
# 외부 호스팅의 회사(테넌트) 관리. 공유 스택(docker-compose.yml)이 떠 있어야 한다. 설명은 README.md.
#
#   ./tenant.sh add <회사> <회사 이름> <임원 이메일> [임원 이름]   새 회사: DB·계정·버킷·비밀값·api·사이트
#   ./tenant.sh update                                            새 코드 배포: 이미지 빌드 → 회사마다 덤프 → 재기동
#   ./tenant.sh ls                                                회사 목록과 api 상태
#
# <회사> 는 주소(<회사>.<ZENITH_DOMAIN>)·DB 이름(zt_<회사>)·버킷(zt-<회사>)에 그대로 들어간다.
set -euo pipefail
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1 # Git Bash 가 /etc/... 인자를 Windows 경로로 바꾸지 않게

die() {
	echo "tenant.sh: $*" >&2
	exit 1
}
[ -f .env ] || die ".env 가 없다 — .env.example 을 복사해 채운다"
ZENITH_DOMAIN=$(sed -n 's/^ZENITH_DOMAIN=//p' .env | tr -d '\r')
[ -n "$ZENITH_DOMAIN" ] || die ".env 에 ZENITH_DOMAIN 이 없다"

dc() { docker compose "$@"; }
# 회사 스택 — 프로젝트 이름이 회사마다 달라 서로의 컨테이너를 건드리지 않는다
tdc() {
	local slug=$1
	shift
	TENANT=$slug docker compose -p "zt-$slug" -f tenant.yml "$@"
}
rand() { openssl rand -hex "$1"; }
SLUG_RE='^[a-z][a-z0-9]{1,19}$'
reload() { dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile; }
build() { docker build -t zenith-api:hosted ../../backend; }
slugs() {
	local f
	for f in tenants/*.env; do
		f=$(basename "$f" .env)
		# 파일 이름이 명령에 들어간다 — add 와 같은 규칙을 통과한 것만(내린 회사의 *.env.off 도 여기서 빠진다)
		[[ $f =~ $SLUG_RE ]] && echo "$f"
	done
	return 0
}

add() {
	[ $# -ge 3 ] || die "사용법: add <회사> <회사 이름> <임원 이메일> [임원 이름]"
	local slug=$1 company=$2 email=$3 name=${4:-관리자}
	# 이 값이 SQL 식별자·버킷 이름·호스트 이름·파일 경로가 된다 — 여기서 좁힌다(소문자로 시작, 소문자·숫자 2~20자)
	[[ $slug =~ $SLUG_RE ]] || die "회사는 소문자로 시작하는 소문자·숫자 2~20자: $slug"
	[[ $email =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]] || die "이메일 모양이 아니다: $email"
	local envf=tenants/$slug.env role=zt_$slug bucket=zt-$slug
	[ ! -e "$envf" ] || die "$slug 는 이미 있다($envf)"
	# 같은 이름의 DB 가 남아 있으면 멈춘다 — 조용히 붙으면 옛 회사의 문서·계정이 새 회사 임원에게 열린다.
	# 비밀값 파일을 잃었거나 add 가 중간에 죽은 같은 회사를 다시 붙일 때만 REATTACH=1.
	local exists
	exists=$(dc exec -T db psql -U zenith -d zenith -Atc "select 1 from pg_database where datname = '$role'")
	[ -z "$exists" ] || [ "${REATTACH:-}" = 1 ] ||
		die "DB $role 가 이미 있다 — 같은 회사를 다시 붙이는 것이면 REATTACH=1 ./tenant.sh add ... (README)"
	trap 'echo "tenant.sh: add 가 중간에 멈췄다 — 원인을 고친 뒤 rm -f '"$envf"' && REATTACH=1 ./tenant.sh add ... 로 다시" >&2' ERR
	docker image inspect zenith-api:hosted >/dev/null 2>&1 || build

	local dbpw s3pw jwt adminpw
	dbpw=$(rand 24) s3pw=$(rand 24) jwt=$(rand 32) adminpw=$(rand 9)

	# 1) DB 와 그 DB 만 여는 계정. PUBLIC 의 CONNECT 를 거둬 다른 회사 계정이 못 붙는다.
	#    계정이 남아 있으면(비밀값 파일을 잃고 다시 붙일 때) 비밀번호만 새로 건다 — DB 는 건드리지 않는다.
	#    vector 확장은 슈퍼유저가 미리 만든다(회사 계정은 못 만든다, 마이그레이션은 IF NOT EXISTS).
	#    비밀번호는 명령줄 인자가 아니라 표준입력으로 넘긴다(ps 에 안 보이게).
	dc exec -T db psql -U zenith -d zenith -v ON_ERROR_STOP=1 <<SQL
\set role $role
\set pw $dbpw
SELECT format('CREATE ROLE %I LOGIN CONNECTION LIMIT 20', :'role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
ALTER ROLE :"role" PASSWORD :'pw';
SELECT format('CREATE DATABASE %I OWNER %I', :'role', :'role')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'role') \gexec
REVOKE CONNECT ON DATABASE :"role" FROM PUBLIC;
-- 공용 DB 에도 회사 계정이 못 붙게(슈퍼유저 zenith 는 그대로 붙는다). 매번 돌려도 같다.
REVOKE CONNECT, TEMPORARY ON DATABASE postgres, zenith, template1 FROM PUBLIC;
\connect :"role"
CREATE EXTENSION IF NOT EXISTS vector;
SQL

	# 2) 버킷과 그 버킷만 여는 키. (값은 전부 위에서 좁힌 slug 와 hex 라 셸·JSON 에 그대로 넣어도 된다)
	dc exec -T minio sh -s <<EOF
set -e
# 루트 키는 환경변수로만(alias set 은 명령줄 인자 + 컨테이너 안 설정 파일에 남는다).
# ponytail: 회사 키는 user add 의 인자라 실행되는 동안 서버의 ps 에 보인다 — 서버 셸은 운영자만 쓴다.
export MC_HOST_local="http://\$MINIO_ROOT_USER:\$MINIO_ROOT_PASSWORD@127.0.0.1:9000"
mc mb --ignore-existing local/$bucket >/dev/null
mc admin user add local $bucket $s3pw >/dev/null
cat >/tmp/$bucket.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],
"Resource":["arn:aws:s3:::$bucket","arn:aws:s3:::$bucket/*"]}]}
JSON
mc admin policy create local $bucket /tmp/$bucket.json >/dev/null
rm /tmp/$bucket.json
# 다시 붙일 때는 이미 걸려 있다 — 그 오류만 넘긴다(이 이미지에는 grep 이 없다)
out=\$(mc admin policy attach local $bucket --user $bucket 2>&1) || case \$out in
*"already in effect"*) ;;
*) echo "\$out" >&2; exit 1 ;;
esac
EOF

	# 3) 회사별 비밀값. 이 파일이 유일한 사본이다 — 서버 밖에 백업할 것(README).
	(
		umask 077
		cat >"$envf" <<EOF
DATABASE_URL=postgresql+asyncpg://$role:$dbpw@db:5432/$role
MINIO_ACCESS_KEY=$bucket
MINIO_SECRET_KEY=$s3pw
MINIO_BUCKET=$bucket
JWT_SECRET=$jwt
EOF
	)

	# 4) 스키마 + 워크스페이스·게시판·채널·임원 계정 하나(scripts/seed.py), 그다음 api 를 띄운다.
	SEED_WORKSPACE=$company SEED_ADMIN_EMAIL=$email SEED_ADMIN_NAME=$name SEED_PASSWORD=$adminpw \
		tdc "$slug" run --rm -T -e SEED_WORKSPACE -e SEED_ADMIN_EMAIL -e SEED_ADMIN_NAME -e SEED_PASSWORD api \
		sh -c "uv run --no-dev alembic upgrade head && uv run --no-dev python scripts/seed.py"
	tdc "$slug" up -d --wait

	# 5) 사이트 블록. 도메인·TLS 는 caddy 의 환경변수라 파일은 회사 이름만 안다.
	#    HSTS 는 여기서 건다 — 공인 인증서(Let's Encrypt)라 단일 스택의 「사내 CA 결정 뒤」 조건이 없다.
	cat >"sites/$slug.caddy" <<EOF
$slug.{\$ZENITH_DOMAIN} {
	tls {\$ZENITH_TLS}
	header Strict-Transport-Security "max-age=31536000"
	import zenith api-$slug:8000
}
EOF
	reload
	trap - ERR

	cat <<EOF

$company 준비 끝.
  주소      https://$slug.$ZENITH_DOMAIN
  임원 계정 $email
  비밀번호  $adminpw   (지금만 보인다 — 전달 뒤 바꾸게 할 것)
EOF
}

update() {
	build
	dc up -d --build # caddy 이미지에 프론트 빌드가 들어 있다
	# Caddyfile·zenith.caddy 는 파일 하나씩 마운트라 git pull 뒤에도 컨테이너는 옛 내용을 본다 — 다시 만들어야 읽는다
	dc up -d --force-recreate caddy
	local slug
	for slug in $(slugs); do
		# 마이그레이션이 돌기 전 덤프(임시 이름 → 성공하면 옮긴다). 이름이 zt_<회사>-*.dump 라 backup 이 14일 뒤 같이 지운다.
		dc exec -T backup sh -c "umask 077; pg_dump -Fc -d zt_$slug -f /backups/.pre.dump && mv /backups/.pre.dump /backups/zt_$slug-pre-\$(date +%F-%H%M).dump" ||
			die "$slug 덤프 실패 — 여기서 멈춘다(앞선 회사는 이미 새 버전)"
		# --wait: 마이그레이션이 깨진 코드면 첫 회사에서 멈춘다(나머지 회사는 옛 버전으로 계속 돈다)
		tdc "$slug" up -d --wait || die "$slug 기동 실패 — 여기서 멈춘다. docker logs zt-$slug-api-1"
	done
}

ls_() {
	local slug
	for slug in $(slugs); do
		printf '%s\thttps://%s.%s\t%s\n' "$slug" "$slug" "$ZENITH_DOMAIN" \
			"$(docker ps -a --filter "label=com.docker.compose.project=zt-$slug" --format '{{.Status}}')"
	done
}

case ${1:-} in
add) shift && add "$@" ;;
update) update ;;
ls) ls_ ;;
*) die "사용법: add <회사> <회사 이름> <임원 이메일> [임원 이름] | update | ls" ;;
esac
