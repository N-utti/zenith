// 릴리스 빌드에서 앱과 함께 콘솔 창이 뜨지 않게 한다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zenith_desktop_lib::run()
}
