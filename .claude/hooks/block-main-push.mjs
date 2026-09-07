#!/usr/bin/env node
// 브랜치 전략 하네스(CLAUDE.md §협업 워크플로): main=트렁크, 직접 push 금지 — PR 만.
// Claude Code PreToolUse 훅. Bash/PowerShell 도구의 git push 가 main 을 겨누면 실행 전에
// 차단한다(exit 2). GitHub 브랜치 보호가 최종 방어선이고 이 훅은 즉시 피드백용 1차 가드.
// prod 브랜치가 생기면 FROZEN 에 추가한다.
const FROZEN = new Set(["main"]);

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    process.exit(0); // 파싱 불가면 차단하지 않는다(오탐으로 작업을 막는 게 더 나쁨).
  }
  // 컴파운드 커맨드에서 push 가 아닌 구간의 'main' 토큰(예: gh pr create --base main)을
  // 오탐하지 않도록, git push 가 든 세그먼트 안의 토큰만 검사한다.
  for (const seg of cmd.split(/&&|\|\||;|\||\n/)) {
    const m = seg.match(/\bgit\b.*\bpush\b(.*)/);
    if (!m) continue;
    // refspec 목적지(dst) 검사 — 'main' / 'HEAD:main' / 'x:main' 전부 차단. 플래그는 건너뛴다.
    for (const t of m[1].split(/\s+/).filter((t) => t && !t.startsWith("-"))) {
      const dst = t.includes(":") ? t.split(":").pop() : t;
      if (FROZEN.has(dst)) {
        console.error(
          `브랜치 전략 위반 차단: '${dst}' 직접 push 금지. 작업 브랜치에서 PR 로 (CLAUDE.md §협업 워크플로).`
        );
        process.exit(2);
      }
    }
  }
  process.exit(0);
});
