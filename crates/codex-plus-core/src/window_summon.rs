//! 单实例场景下唤出已有窗口。
//!
//! 管理器关闭窗口只是隐藏到托盘、进程不退出并持有单实例锁；此时用户再双击
//! 桌面图标，新实例会因拿不到锁直接退出——看起来就是"点了没反应"。
//! 这里在退出前尝试把已有实例的窗口恢复并置前，保证双击永远有反馈。

#[cfg(windows)]
pub fn summon_window_by_title(title: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };

    unsafe {
        let wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
        let hwnd = match FindWindowW(PCWSTR::null(), PCWSTR::from_raw(wide.as_ptr())) {
            Ok(hwnd) => hwnd,
            Err(_) => HWND::default(),
        };
        if hwnd.is_invalid() {
            return false;
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        let _ = SetForegroundWindow(hwnd);
        true
    }
}

#[cfg(not(windows))]
pub fn summon_window_by_title(_title: &str) -> bool {
    false
}
