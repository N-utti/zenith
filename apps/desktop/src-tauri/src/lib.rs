use std::{sync::Mutex, time::Duration};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_updater::{Update, UpdaterExt};

/// 자동 시작으로 켜질 때 붙는 인자. 이때는 창을 띄우지 않고 트레이에만 둔다.
const AUTOSTART_ARG: &str = "--autostart";

/// 업데이트 설치 직전에 설정 폴더에 남기는 표시 파일. 다시 켜질 때 보면 지우고 창을 띄운다.
const SHOW_AFTER_UPDATE: &str = "show-after-update";

/// 트레이로 숨겨 둔(또는 최소화한) 메인 창을 앞으로 꺼낸다.
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 트레이 아이콘과 메뉴(열기 · PC 켤 때 같이 켜기 · 종료).
///
/// 자동 시작은 처음 켤 때 한 번만 켠다. 그 뒤로는 사용자가 메뉴에서 끈 것을 존중해야 하므로
/// 설정 폴더에 표시 파일을 남겨 「이미 한 번 켰음」을 기억한다. 켜짐 여부 자체는 Windows 시작 프로그램
/// 레지스트리가 들고 있다. 개발 빌드는 설치본과 같은 레지스트리 이름·표시 파일을 쓰므로 자동으로 켜지 않는다.
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let autolaunch = app.autolaunch();
    let marker = app.path().app_config_dir()?.join("autostart-initialized");
    if !cfg!(debug_assertions) && !marker.exists() && autolaunch.enable().is_ok() {
        if let Some(dir) = marker.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&marker, "");
    }

    let open = MenuItem::with_id(app, "open", "제니스 열기", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "PC 켤 때 같이 켜기",
        true,
        autolaunch.is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &autostart, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let autostart_item = autostart.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("앱 아이콘이 없습니다"))
        .tooltip("제니스")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "autostart" => {
                // 체크 표시는 누를 때 이미 뒤집혀 있다. 레지스트리를 그에 맞춘다.
                let on = autostart_item.is_checked().unwrap_or(false);
                let result = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
                if result.is_err() {
                    let _ = autostart_item.set_checked(!on);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

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
/// 설치가 끝나면 다시 뜬다(PC 켤 때 트레이로 떴던 경우에도 창을 띄운다, `SHOW_AFTER_UPDATE`).
/// 관리자 확인(UAC)을 거절하면 설치 없이 꺼진 채로 남는다.
#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, Pending>,
) -> Result<(), String> {
    let Some(update) = pending.0.lock().unwrap().take() else {
        return Ok(());
    };
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join(SHOW_AFTER_UPDATE), "");
    }
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
///
/// 제니스는 필요할 때만 켜는 앱이 아니라 하루 내내 떠 있는 업무 공간이다. 그래서 창을 닫아도 꺼지지 않고
/// 트레이에 남아 알림을 계속 받고, PC 를 켜면 트레이로 같이 켜진다. 완전히 끄는 길은 트레이 메뉴의 「종료」.
pub fn run() {
    tauri::Builder::default()
        // 두 번째 실행(바탕화면·시작 메뉴 아이콘 다시 누르기)은 새 창 대신 떠 있는 창을 꺼낸다.
        // 다른 플러그인보다 먼저 등록해야 한다.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        // 바깥 링크를 기본 브라우저로 넘기기 위한 플러그인.
        // 프론트엔드 쪽 짝은 frontend/src/lib/desktop.ts 다.
        .plugin(tauri_plugin_opener::init())
        // 창을 보고 있지 않을 때 새 채팅을 Windows 토스트로 띄운다.
        .plugin(tauri_plugin_notification::init())
        // 자동 업데이트. 웹앱이 켜질 때 check_update 를 부르고, 사용자가 고르면 install_update.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(Pending(Mutex::new(None)));
            // 트레이는 덤이다. 못 만들어도 앱은 뜨되, 숨은 창을 꺼낼 길이 줄었으니 창을 보여 준다.
            let tray_ok = setup_tray(app.handle())
                .map_err(|e| eprintln!("트레이 생성 실패: {e}"))
                .is_ok();
            // 업데이트로 다시 켜질 때 설치 프로그램은 직전 실행 인자(--autostart 포함)를 그대로 넘긴다.
            // 사용자가 직접 「설치」를 눌렀으니 창이 다시 보여야 한다.
            let after_update = app
                .path()
                .app_config_dir()
                .map(|dir| std::fs::remove_file(dir.join(SHOW_AFTER_UPDATE)).is_ok())
                .unwrap_or(false);
            // 창은 숨긴 채로 만들어진다(tauri.conf.json visible: false). 자동 시작이면 트레이에만 둔다.
            let autostart = std::env::args_os().any(|arg| arg == AUTOSTART_ARG);
            if !tray_ok || after_update || !autostart {
                show_main(app.handle());
            }
            Ok(())
        })
        // 창 닫기(X)는 숨기기로 바꾼다. 앱이 살아 있어야 채팅 알림이 계속 뜬다.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![check_update, install_update, clear_notifications])
        .run(tauri::generate_context!())
        .expect("제니스 데스크탑 셸을 시작하지 못했습니다");
}
