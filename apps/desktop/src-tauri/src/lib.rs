use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
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
    // 사외 시연판(tauri.demo.conf.json)은 남의 PC 에 깔리므로 시작 프로그램에 스스로 넣지 않는다.
    let demo = app.config().identifier.ends_with(".demo");
    if !cfg!(debug_assertions) && !demo && !marker.exists() && autolaunch.enable().is_ok() {
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
        .tooltip(if cfg!(debug_assertions) { "제니스 dev" } else { "제니스" })
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
            "quit" => request_quit(app),
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

/// 트레이 「종료」를 눌렀는지. 누르기 전에는 `quit_app` 을 듣지 않는다(웹앱 스크립트가 아무 때나 앱을 끄지 못하게).
static QUITTING: AtomicBool = AtomicBool::new(false);

/// `logout_and_exit` 을 이미 시작했는지. 웹앱의 `quit_app` 과 3초 타이머가 겹쳐도 한 번만 끈다.
static EXITING: AtomicBool = AtomicBool::new(false);

/// 트레이 「종료」. 창을 닫는 것(트레이로 숨기기)과 달리 자리를 뜬다는 뜻이라 로그아웃하고 끈다.
/// 창부터 숨기고 웹앱에 알리면 웹앱이 서버에 로그아웃한 뒤 `quit_app` 을 부른다. 웹앱이 아직 안 떴거나
/// 서버가 답이 없어도 3초 뒤에는 끈다. 어느 쪽이든 `logout_and_exit` 을 거친다.
fn request_quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    // 꺼지는 3초 사이에 트레이에서 다시 여는 일이 없게 아이콘부터 치운다.
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_visible(false);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        logout_and_exit(&app);
    });
}

/// 서버 로그아웃이 실패해도(오프라인·서버 장애·3초 초과) 다음에 켰을 때 앞사람으로 들어가지 않게, 웹뷰의 쿠키를
/// 전부 지우고 알림 센터를 비운 뒤 끈다. 세션 쿠키는 HttpOnly·14일 영속이라 웹앱이 못 지운다.
/// Windows 에서 `cookies()` 는 동기 명령·이벤트 처리기 안에서 부르면 멈춘다. 별도 스레드나 async 명령에서만 부른다.
fn logout_and_exit(app: &AppHandle) {
    if EXITING.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        for cookie in window.cookies().unwrap_or_default() {
            let _ = window.delete_cookie(cookie);
        }
    }
    let _ = clear_notifications(app.clone());
    app.exit(0);
}

/// 웹앱이 종료 전 로그아웃을 끝냈을 때 부른다(`request_quit`). async 라 메인 스레드 밖에서 돈다(`logout_and_exit`).
#[tauri::command]
async fn quit_app(app: AppHandle) {
    if QUITTING.load(Ordering::SeqCst) {
        logout_and_exit(&app);
    }
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

/// OS 알림(Windows 토스트)을 띄우고, 누르면 숨어 있던 창을 꺼낸다.
///
/// 알림 플러그인의 `notify` 는 데스크톱에서 클릭을 받지 않는다(안에서 만든 클릭 핸들을 그대로 버린다).
/// 그래서 트레이에 숨긴 채 알림을 누르면 아무 일도 없었다. 토스트를 여기서 직접 띄워 클릭을 붙든다.
/// 권한 묻기는 그대로 플러그인이 한다.
///
/// ponytail: 클릭은 앱이 떠 있는 동안 이 프로세스가 받는다. 앱을 종료한 뒤 알림 센터에서 누르는 경우까지
/// 받으려면 COM 활성화기(ToastActivatorCLSID)를 바로가기에 등록해야 한다. 트레이 상주라 지금은 두지 않는다.
#[tauri::command]
async fn notify(app: AppHandle, title: String, body: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        // 설치본만 앱 id 로 띄운다. target/ 에서 실행하면 그 id 의 바로가기가 없어 토스트가 안 뜨므로
        // 플러그인처럼 PowerShell 이름을 빌린다(README 알림 절).
        let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
        let unbundled = exe
            .parent()
            .is_some_and(|dir| dir.ends_with("target/debug") || dir.ends_with("target/release"));
        let app_id = if unbundled {
            Toast::POWERSHELL_APP_ID.to_string()
        } else {
            app.config().identifier.clone()
        };
        let handle = app.clone();
        Toast::new(&app_id)
            .title(&title)
            .text2(body.as_deref().unwrap_or(""))
            // 플러그인 때처럼 무음. 비워 두면 채팅이 몰릴 때 기본 알림음이 줄줄이 난다.
            .sound(None)
            .on_activated(move |_| {
                show_main(&handle);
                Ok(())
            })
            .show()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        let mut builder = app.notification().builder().title(title);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        builder.show().map_err(|e| e.to_string())?;
    }
    Ok(())
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

/// 개발 빌드의 작업 표시줄 우클릭 메뉴 맨 위 이름. 시작 메뉴 바로 가기가 없는 실행 파일은 파일 이름(zenith-desktop)으로
/// 나오므로 창에 앱 id·다시 실행 명령·표시 이름을 직접 붙인다.
#[cfg(all(windows, debug_assertions))]
fn label_dev_taskbar(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::{
        Foundation::HWND,
        Storage::EnhancedStorage::{
            PKEY_AppUserModel_ID, PKEY_AppUserModel_RelaunchCommand,
            PKEY_AppUserModel_RelaunchDisplayNameResource,
        },
        System::{
            Com::StructuredStorage::{PropVariantChangeType, PROPVARIANT, PVCHF_DEFAULT},
            Variant::VT_LPWSTR,
        },
        UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
    };
    // 이 속성들은 VT_LPWSTR 만 받는다. From<&str> 은 BSTR 이라 바꿔 넣는다.
    let text = |s: &str| -> windows::core::Result<PROPVARIANT> {
        let mut out = PROPVARIANT::default();
        unsafe { PropVariantChangeType(&mut out, &PROPVARIANT::from(s), PVCHF_DEFAULT, VT_LPWSTR)? };
        Ok(out)
    };
    let exe = std::env::current_exe()?;
    let store: IPropertyStore = unsafe { SHGetPropertyStoreForWindow(HWND(window.hwnd()?.0))? };
    unsafe {
        store.SetValue(&PKEY_AppUserModel_ID, &text("kr.zenith.desktop.dev")?)?;
        store.SetValue(&PKEY_AppUserModel_RelaunchCommand, &text(&format!("\"{}\"", exe.display()))?)?;
        store.SetValue(&PKEY_AppUserModel_RelaunchDisplayNameResource, &text("제니스 dev")?)?;
        store.Commit()?;
    }
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
/// 트레이에 남아 알림을 계속 받고, PC 를 켜면 트레이로 같이 켜진다. 완전히 끄는 길은 트레이 메뉴의 「종료」이고, 이때는 로그아웃한다.
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
        // 알림 권한. 토스트 자체는 클릭을 받으려고 `notify` 명령이 직접 띄운다.
        .plugin(tauri_plugin_notification::init())
        // 자동 업데이트. 웹앱이 켜질 때 check_update 를 부르고, 사용자가 고르면 install_update.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(Pending(Mutex::new(None)));
            // 개발 빌드(npm run dev)는 지금 떠 있는 창이 개발판인지 작업 표시줄·트레이에서 한눈에 알게 이름에 dev 를 붙인다.
            if cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title("제니스 · Zenith dev");
                    #[cfg(all(windows, debug_assertions))]
                    if let Err(e) = label_dev_taskbar(&window) {
                        eprintln!("작업 표시줄 이름 붙이기 실패: {e}");
                    }
                }
            }
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
        .invoke_handler(tauri::generate_handler![
            check_update,
            install_update,
            clear_notifications,
            quit_app,
            notify
        ])
        .run(tauri::generate_context!())
        .expect("제니스 데스크탑 셸을 시작하지 못했습니다");
}
