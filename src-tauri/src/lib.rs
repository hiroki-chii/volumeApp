use std::{
    fs,
    mem::size_of,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewWindow,
    WindowEvent,
};
use windows::{
    core::Result as WindowsResult,
    Win32::{
        Foundation::{LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{
            CreateRoundRectRgn, GetMonitorInfoW, MonitorFromPoint, SetWindowRgn,
            MONITOR_DEFAULTTONEAREST, MONITORINFO,
        },
        Media::Audio::{
            Endpoints::IAudioEndpointVolume, eConsole, eRender, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED},
        UI::{
            HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, GetWindowRect,
            SetWindowsHookExW, TranslateMessage, HHOOK, MSLLHOOKSTRUCT, MSG,
            WH_MOUSE_LL, WM_MBUTTONDOWN,
            WM_MOUSEWHEEL,
            },
        },
    },
};

const OSD_WIDTH: i32 = 300;
const OSD_HEIGHT: i32 = 80;
const PANEL_WIDTH: i32 = 320;
const PANEL_HEIGHT: i32 = 280;
const EDGE_MARGIN: i32 = 20;
const OSD_BOTTOM_MARGIN: i32 = 0;
const HIDE_DELAY: Duration = Duration::from_millis(1500);

static HOOK_APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Clone, Serialize, Deserialize)]
struct Settings {
    step: u8,
}

impl Default for Settings {
    fn default() -> Self {
        Self { step: 2 }
    }
}

#[derive(Clone)]
struct AudioState {
    volume: u8,
    muted: bool,
}

struct AppState {
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    audio: Mutex<AudioState>,
    audio_apply_lock: Mutex<()>,
    hovering: AtomicBool,
    settings_mode: AtomicBool,
    hide_generation: AtomicU64,
}

fn endpoint_volume() -> WindowsResult<IAudioEndpointVolume> {
    unsafe {
        // Tauri command threads do not guarantee a COM apartment. A pre-existing apartment is
        // acceptable here, so the result is intentionally ignored.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

fn read_audio_state() -> WindowsResult<AudioState> {
    unsafe {
        let endpoint = endpoint_volume()?;
        let volume = (endpoint.GetMasterVolumeLevelScalar()? * 100.0).round().clamp(0.0, 100.0) as u8;
        let muted = endpoint.GetMute()?.as_bool();
        Ok(AudioState { volume, muted })
    }
}

fn write_audio_state(audio: &AudioState) -> WindowsResult<()> {
    unsafe {
        let endpoint = endpoint_volume()?;
        endpoint.SetMasterVolumeLevelScalar(audio.volume as f32 / 100.0, std::ptr::null())?;
        endpoint.SetMute(audio.muted, std::ptr::null())
    }
}

fn app_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("settings.json");

    // Electron used %APPDATA%\\volume-app. Import its lightweight JSON store on the first run.
    if !path.exists() {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let legacy_path = PathBuf::from(app_data).join("volume-app").join("settings.json");
            if let Ok(contents) = fs::read(&legacy_path) {
                let _ = fs::write(&path, contents);
            }
        }
    }
    Ok(path)
}

fn load_settings(path: &PathBuf) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn save_settings(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    let contents = serde_json::to_string(settings).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn monitor_info(point: POINT) -> Option<MONITORINFO> {
    unsafe {
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(monitor, &mut info).as_bool().then_some(info)
    }
}

fn monitor_scale(point: POINT) -> f64 {
    unsafe {
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut dpi_x = 96;
        let mut dpi_y = 96;
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_ok() {
            dpi_x as f64 / 96.0
        } else {
            1.0
        }
    }
}

fn cursor_position() -> Option<POINT> {
    unsafe {
        let mut point = POINT::default();
        GetCursorPos(&mut point).ok().map(|_| point)
    }
}

fn is_cursor_over_window(window: &WebviewWindow) -> bool {
    let (Ok(hwnd), Some(point)) = (window.hwnd(), cursor_position()) else {
        return false;
    };
    unsafe {
        let mut bounds = RECT::default();
        GetWindowRect(hwnd, &mut bounds).is_ok()
            && point.x >= bounds.left
            && point.x < bounds.right
            && point.y >= bounds.top
            && point.y < bounds.bottom
    }
}

fn is_point_over_taskbar(point: POINT) -> bool {
    let Some(info) = monitor_info(point) else {
        return false;
    };
    let monitor = info.rcMonitor;
    let work = info.rcWork;
    let is_inside_monitor = point.x >= monitor.left
        && point.x < monitor.right
        && point.y >= monitor.top
        && point.y < monitor.bottom;
    let is_inside_work_area = point.x >= work.left
        && point.x < work.right
        && point.y >= work.top
        && point.y < work.bottom;
    is_inside_monitor && !is_inside_work_area
}

fn set_window_bounds(
    window: &WebviewWindow,
    width: i32,
    height: i32,
    point: POINT,
    show_inactive: bool,
) -> Result<(), String> {
    let Some(info) = monitor_info(point) else {
        return Ok(());
    };
    let work = info.rcWork;
    let scale = monitor_scale(point);
    let horizontal_margin = EDGE_MARGIN as f64;
    let bottom_margin = if width == OSD_WIDTH && height == OSD_HEIGHT {
        OSD_BOTTOM_MARGIN as f64
    } else {
        EDGE_MARGIN as f64
    };
    let x = work.right as f64 / scale - width as f64 - horizontal_margin;
    let y = work.bottom as f64 / scale - height as f64 - bottom_margin;
    // Re-apply these flags on every resize/show cycle. Windows can restore the native
    // non-client frame after a DPI or monitor transition even when the initial config is frameless.
    window
        .set_decorations(false)
        .map_err(|error| error.to_string())?;
    window
        .set_shadow(false)
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(width as f64, height as f64))
        .map_err(|error| error.to_string())?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;

    // The transparent window is rectangular by default, which leaves visible transparent
    // pixels at the four corners of the rounded OSD card. Clip the native window to the same
    // rounded shape so the window boundary and the rendered card are identical.
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let physical_size = window.inner_size().map_err(|error| error.to_string())?;
    let radius = (16.0 * scale).round() as i32;
    unsafe {
        let region = CreateRoundRectRgn(
            0,
            0,
            physical_size.width as i32,
            physical_size.height as i32,
            radius,
            radius,
        );
        if SetWindowRgn(hwnd, Some(region), true) == 0 {
            return Err("Failed to clip the transparent window region".to_string());
        }
    }
    if show_inactive {
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())
}

fn resize_window_internal(app: &AppHandle, width: i32, height: i32) -> Result<(), String> {
    let window = main_window(app)?;
    if let Some(point) = cursor_position() {
        set_window_bounds(&window, width, height, point, false)?;
    }
    Ok(())
}

fn reset_hide_timer(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let generation = state.hide_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(HIDE_DELAY);
        let state = handle.state::<Arc<AppState>>();
        if generation == state.hide_generation.load(Ordering::SeqCst)
            && !state.settings_mode.load(Ordering::SeqCst)
        {
            if let Some(window) = handle.get_webview_window("main") {
                if state.hovering.load(Ordering::SeqCst) && is_cursor_over_window(&window) {
                    // Keep the OSD visible while the pointer is actually over it. Checking the
                    // native bounds as well as the webview event avoids stale hover state.
                    reset_hide_timer(&handle);
                } else {
                    let _ = window.hide();
                }
            }
        }
    });
}

fn show_osd(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    if state.settings_mode.swap(false, Ordering::SeqCst) {
        let _ = resize_window_internal(app, OSD_WIDTH, OSD_HEIGHT);
        let _ = app.emit("force-osd", ());
    }

    if let Ok(window) = main_window(app) {
        if let Some(point) = cursor_position() {
            let _ = set_window_bounds(&window, OSD_WIDTH, OSD_HEIGHT, point, true);
        }
        let _ = window.set_always_on_top(true);
    }
    reset_hide_timer(app);
}

fn apply_current_audio(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let _apply_lock = state.audio_apply_lock.lock().expect("audio lock poisoned");
    let audio = state.audio.lock().expect("audio state lock poisoned").clone();
    if let Err(error) = write_audio_state(&audio) {
        eprintln!("Failed to apply audio state: {error}");
    }
}

fn change_volume_from_hook(app: &AppHandle, increase: bool) {
    let state = app.state::<Arc<AppState>>();
    let step = state.settings.lock().expect("settings lock poisoned").step;
    let audio = {
        let mut audio = state.audio.lock().expect("audio state lock poisoned");
        let rounded = ((audio.volume as i16 + step as i16 / 2) / step as i16) * step as i16;
        audio.volume = if increase {
            (rounded + step as i16).min(100) as u8
        } else {
            (rounded - step as i16).max(0) as u8
        };
        audio.muted = false;
        audio.clone()
    };
    let _ = app.emit("volume-updated", audio.volume);
    let _ = app.emit("mute-updated", false);
    show_osd(app);
    apply_current_audio(app);
}

fn toggle_mute_from_hook(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let muted = {
        let mut audio = state.audio.lock().expect("audio state lock poisoned");
        audio.muted = !audio.muted;
        audio.muted
    };
    let _ = app.emit("mute-updated", muted);
    show_osd(app);
    apply_current_audio(app);
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let mouse = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if is_point_over_taskbar(mouse.pt) {
            if let Some(app) = HOOK_APP.get() {
                match wparam.0 as u32 {
                    WM_MOUSEWHEEL => {
                        let wheel_delta = ((mouse.mouseData >> 16) as i16) as i32;
                        if wheel_delta != 0 {
                            change_volume_from_hook(app, wheel_delta > 0);
                        }
                    }
                    WM_MBUTTONDOWN => toggle_mute_from_hook(app),
                    _ => {}
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn start_mouse_hook(app: AppHandle) {
    if HOOK_APP.set(app).is_err() {
        return;
    }
    thread::spawn(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let hook: HHOOK = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0) {
            Ok(hook) => hook,
            Err(error) => {
                eprintln!("Unable to install mouse hook: {error}");
                return;
            }
        };
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        let _ = hook;
    });
}

#[tauri::command]
fn get_volume(state: State<'_, Arc<AppState>>) -> Result<u8, String> {
    if let Ok(audio) = read_audio_state() {
        *state.audio.lock().expect("audio state lock poisoned") = audio;
    }
    Ok(state.audio.lock().expect("audio state lock poisoned").volume)
}

#[tauri::command]
fn set_volume(app: AppHandle, state: State<'_, Arc<AppState>>, volume: u8) -> Result<(), String> {
    state.audio.lock().expect("audio state lock poisoned").volume = volume.min(100);
    apply_current_audio(&app);
    Ok(())
}

#[tauri::command]
fn get_mute(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    if let Ok(audio) = read_audio_state() {
        *state.audio.lock().expect("audio state lock poisoned") = audio;
    }
    Ok(state.audio.lock().expect("audio state lock poisoned").muted)
}

#[tauri::command]
fn set_mute(app: AppHandle, state: State<'_, Arc<AppState>>, muted: bool) -> Result<(), String> {
    state.audio.lock().expect("audio state lock poisoned").muted = muted;
    apply_current_audio(&app);
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<AppState>>) -> Settings {
    state.settings.lock().expect("settings lock poisoned").clone()
}

#[tauri::command]
fn set_setting(state: State<'_, Arc<AppState>>, key: String, value: u8) -> Result<Settings, String> {
    if key != "step" {
        return Err("Unknown setting".to_string());
    }
    let settings = {
        let mut settings = state.settings.lock().expect("settings lock poisoned");
        settings.step = value.clamp(1, 10);
        settings.clone()
    };
    save_settings(&state.settings_path, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn resize_window(app: AppHandle, state: State<'_, Arc<AppState>>, width: i32, height: i32) -> Result<(), String> {
    state.settings_mode.store(height > OSD_HEIGHT, Ordering::SeqCst);
    resize_window_internal(&app, width, height)?;
    Ok(())
}

#[tauri::command]
fn set_hover(app: AppHandle, state: State<'_, Arc<AppState>>, hovering: bool) {
    state.hovering.store(hovering, Ordering::SeqCst);
    if !hovering && !state.settings_mode.load(Ordering::SeqCst) {
        reset_hide_timer(&app);
    }
}

fn open_settings(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    state.settings_mode.store(true, Ordering::SeqCst);
    let _ = resize_window_internal(app, PANEL_WIDTH, PANEL_HEIGHT);
    let _ = app.emit("open-settings", ());
    if let Ok(window) = main_window(app) {
        let _ = window.show();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let settings_path = app_settings_path(&handle)?;
            let settings = load_settings(&settings_path);
            let audio = read_audio_state().unwrap_or(AudioState {
                volume: 50,
                muted: false,
            });
            app.manage(Arc::new(AppState {
                settings_path,
                settings: Mutex::new(settings),
                audio: Mutex::new(audio),
                audio_apply_lock: Mutex::new(()),
                hovering: AtomicBool::new(false),
                settings_mode: AtomicBool::new(false),
                hide_generation: AtomicU64::new(0),
            }));

            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &separator, &quit_item])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().expect("application icon is missing").clone())
                .tooltip("Volume App")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "settings" => open_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let window = main_window(&handle)?;
            // Enforce a frameless transparent window at runtime as well as in tauri.conf.json.
            // This prevents a stale/native title bar from becoming visible as transparent space
            // above the OSD on Windows.
            window.set_decorations(false)?;
            window.set_shadow(false)?;
            let focus_handle = handle.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Focused(false)) {
                    let state = focus_handle.state::<Arc<AppState>>();
                    if state.settings_mode.swap(false, Ordering::SeqCst) {
                        let _ = main_window(&focus_handle).and_then(|window| {
                            window.hide().map_err(|error| error.to_string())
                        });
                        let _ = focus_handle.emit("force-osd", ());
                    }
                }
            });
            start_mouse_hook(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_volume,
            set_volume,
            get_mute,
            set_mute,
            get_settings,
            set_setting,
            resize_window,
            set_hover
        ])
        .run(tauri::generate_context!())
        .expect("error while running Volume App");
}
