/// 데스크탑 셸의 진입점.
///
/// 셸은 화면을 띄우는 일만 한다. 업무 로직은 전부 웹앱(`frontend/`)에 있고,
/// 데이터는 사내 서버에 있다. 여기에 기능을 더하기 전에 그 웹앱에서 할 수 없는
/// 일인지 먼저 확인할 것 — Windows·Android·iOS가 같은 화면을 공유하는 구조라
/// 셸에 넣은 기능은 셸마다 다시 만들어야 한다.
pub fn run() {
    tauri::Builder::default()
        // 바깥 링크를 기본 브라우저로 넘기기 위한 플러그인.
        // 프론트엔드 쪽 짝은 frontend/src/lib/desktop.ts 다.
        .plugin(tauri_plugin_opener::init())
        // 창을 보고 있지 않을 때 새 채팅을 Windows 토스트로 띄운다.
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("제니스 데스크탑 셸을 시작하지 못했습니다");
}
