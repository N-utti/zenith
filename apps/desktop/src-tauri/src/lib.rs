use std::{sync::Mutex, time::Duration};
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

/// `check_update` 가 찾아 둔 새 버전. 사용자가 설치를 고르면 `install_update` 가 꺼내 쓴다.
struct Pending(Mutex<Option<Update>>);

/// 사내 서버의 매니페스트(`{서버}/desktop/latest.json`)를 보고 새 버전 번호를 돌려준다. 없으면 null.
///
/// 서버 주소는 웹앱이 넘긴다. 현장에서 바꾼 주소(`frontend/src/lib/serverOrigin.ts`)를
/// 셸이 따로 알 방법이 없어서다. 주소가 무엇이든 설치본은 `tauri.conf.json` 의 pubkey 로
/// 서명을 검증한 뒤에만 깔리고, 예전 버전으로 되돌리는 설치는 `.msi` 가 거부한다(allowDowngrades).
#[tauri::command]
async fn check_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, Pending>,
    origin: String,
) -> Result<Option<String>, String> {
    let manifest = format!("{}/desktop/latest.json", origin.trim_end_matches('/'));
    let url = tauri::Url::parse(&manifest).map_err(|e| e.to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .and_then(|b| b.timeout(Duration::from_secs(120)).build())
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let version = update.as_ref().map(|u| u.version.clone());
    *pending.0.lock().unwrap() = update;
    Ok(version)
}

/// 찾아 둔 새 버전을 받아 설치 프로그램(passive)을 띄운다. Windows 에서는 여기서 앱이 종료되고
/// 설치가 끝나면 다시 뜬다. 관리자 확인(UAC)을 거절하면 설치 없이 꺼진 채로 남는다.
#[tauri::command]
async fn install_update(pending: tauri::State<'_, Pending>) -> Result<(), String> {
    let Some(update) = pending.0.lock().unwrap().take() else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())
}

/// Windows 알림 센터에 쌓인 이 앱의 알림을 지운다. 채팅 알림에는 메시지 본문이 들어 있어, 공용 PC 에서
/// 로그아웃한 뒤에도 다음 사람이 알림 센터로 앞사람의 DM 을 읽을 수 있었다. 웹앱이 로그인·로그아웃 때 부른다.
///
/// 알림 플러그인과 같은 앱 id(`identifier`)로 지운다. 설치하지 않고 target/debug·target/release 에서 실행하면
/// 플러그인이 PowerShell 이름으로 띄우므로 여기서 지워지지 않는다. 확인은 `.msi` 설치본으로 한다.
#[tauri::command]
fn clear_notifications(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::{core::HSTRING, UI::Notifications::ToastNotificationManager};
        ToastNotificationManager::History()
            .and_then(|history| history.ClearWithId(&HSTRING::from(app.config().identifier.as_str())))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = app;
    Ok(())
}

/// 데스크탑 셸의 진입점.
///
/// 셸은 화면을 띄우는 일만 한다. 업무 로직은 전부 웹앱(`frontend/`)에 있고,
/// 데이터는 사내 서버에 있다. 여기에 기능을 더하기 전에 그 웹앱에서 할 수 없는
/// 일인지 먼저 확인할 것. Windows·Android·iOS가 같은 화면을 공유하는 구조라
/// 셸에 넣은 기능은 셸마다 다시 만들어야 한다.
pub fn run() {
    tauri::Builder::default()
        // 바깥 링크를 기본 브라우저로 넘기기 위한 플러그인.
        // 프론트엔드 쪽 짝은 frontend/src/lib/desktop.ts 다.
        .plugin(tauri_plugin_opener::init())
        // 창을 보고 있지 않을 때 새 채팅을 Windows 토스트로 띄운다.
        .plugin(tauri_plugin_notification::init())
        // 자동 업데이트. 웹앱이 켜질 때 check_update 를 부르고, 사용자가 고르면 install_update.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(Pending(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_update, install_update, clear_notifications])
        .run(tauri::generate_context!())
        .expect("제니스 데스크탑 셸을 시작하지 못했습니다");
}
