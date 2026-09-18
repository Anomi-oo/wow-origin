use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, State, WindowEvent,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const NODE_RUNTIME_BOOTSTRAP: &str = include_str!("node-runtime-bootstrap.cjs");
const MAX_CAPTURED_STDERR_BYTES: usize = 8 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendSnapshot {
    state: String,
    base_url: String,
    error: String,
    log_path: String,
}

#[derive(Deserialize)]
struct ReadyPayload {
    port: u16,
}

impl BackendSnapshot {
    fn starting() -> Self {
        Self {
            state: "starting".into(),
            base_url: String::new(),
            error: String::new(),
            log_path: String::new(),
        }
    }
}

struct BackendState {
    snapshot: Mutex<BackendSnapshot>,
    child: Mutex<Option<(u64, CommandChild)>>,
    generation: AtomicU64,
    starting: AtomicBool,
    exiting: AtomicBool,
    last_stderr: Mutex<String>,
}

impl BackendState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshot: Mutex::new(BackendSnapshot::starting()),
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
            starting: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
            last_stderr: Mutex::new(String::new()),
        })
    }
}

#[tauri::command]
fn backend_status(state: State<'_, Arc<BackendState>>) -> BackendSnapshot {
    state
        .snapshot
        .lock()
        .expect("backend snapshot lock")
        .clone()
}

fn runtime_script<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|directory| {
            directory
                .join("server-runtime")
                .join("dist")
                .join("server.js")
        })
        .map_err(|error| error.to_string())
}

fn set_failed(state: &BackendState, message: String) {
    let mut snapshot = state.snapshot.lock().expect("backend snapshot lock");
    snapshot.state = "failed".into();
    snapshot.base_url.clear();
    snapshot.error = message;
}

fn append_backend_log(log_path: &PathBuf, stream: &str, bytes: &[u8]) {
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) else {
        return;
    };
    let text = String::from_utf8_lossy(bytes);
    let _ = writeln!(file, "[{stream}] {}", text.trim_end());
}

fn capture_stderr(state: &BackendState, bytes: &[u8]) {
    let text = String::from_utf8_lossy(bytes);
    let mut captured = state.last_stderr.lock().expect("backend stderr lock");
    captured.push_str(&text);
    if !text.ends_with('\n') {
        captured.push('\n');
    }
    if captured.len() > MAX_CAPTURED_STDERR_BYTES {
        let mut start = captured.len() - MAX_CAPTURED_STDERR_BYTES;
        while !captured.is_char_boundary(start) {
            start += 1;
        }
        captured.drain(..start);
    }
}

fn start_backend<R: Runtime>(app: AppHandle<R>, state: Arc<BackendState>) -> Result<(), String> {
    if state.starting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    *state.snapshot.lock().expect("backend snapshot lock") = BackendSnapshot::starting();
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(data_dir.join("data")).map_err(|error| error.to_string())?;
    let logs_dir = data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|error| error.to_string())?;
    let log_path = logs_dir.join("backend.log");
    std::fs::write(&log_path, "=== Wow backend start ===\n").map_err(|error| error.to_string())?;
    state
        .last_stderr
        .lock()
        .expect("backend stderr lock")
        .clear();
    state
        .snapshot
        .lock()
        .expect("backend snapshot lock")
        .log_path = log_path.to_string_lossy().into_owned();
    let script = runtime_script(&app)?;
    if !script.is_file() {
        return Err(format!("桌面运行入口不存在：{}", script.display()));
    }
    let command = app
        .shell()
        .sidecar("node")
        .map_err(|error| error.to_string())?
        // Windows 安装路径可能包含盘符、反斜杠和空格。不要把绝对路径
        // 传入 Node；内嵌启动器会根据 sidecar 自身位置寻找运行资源。
        .arg("--eval")
        .arg(NODE_RUNTIME_BOOTSTRAP)
        .current_dir(data_dir)
        .env("WOW_DESKTOP", "1")
        .env("NODE_ENV", "production")
        .env("HOST", "0.0.0.0")
        .env("PORT", "23231")
        .env("PORT_FALLBACK", "1")
        .env("CORS_ALLOW_ORIGIN", "*");
    let (mut events, child) = command.spawn().map_err(|error| error.to_string())?;
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.child.lock().expect("backend child lock") = Some((generation, child));
    state.starting.store(false, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    append_backend_log(&log_path, "stdout", &bytes);
                    let line = String::from_utf8_lossy(&bytes);
                    if state.generation.load(Ordering::SeqCst) == generation {
                        if let Some(payload) = line.trim().strip_prefix("WOW_ORIGIN_READY:") {
                            if let Ok(ReadyPayload { port }) = serde_json::from_str(payload) {
                                *state.snapshot.lock().expect("backend snapshot lock") =
                                    BackendSnapshot {
                                        state: "ready".into(),
                                        base_url: format!("http://127.0.0.1:{port}"),
                                        error: String::new(),
                                        log_path: log_path.to_string_lossy().into_owned(),
                                    };
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    append_backend_log(&log_path, "stderr", &bytes);
                    capture_stderr(&state, &bytes);
                    eprintln!("{}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(error) => {
                    if state.generation.load(Ordering::SeqCst) == generation {
                        append_backend_log(&log_path, "error", error.as_bytes());
                        set_failed(
                            &state,
                            format!("{error}\n日志文件：{}", log_path.display()),
                        );
                    }
                }
                CommandEvent::Terminated(status) => {
                    let is_current = state.generation.load(Ordering::SeqCst) == generation;
                    if is_current {
                        let mut child = state.child.lock().expect("backend child lock");
                        if child.as_ref().is_some_and(|(id, _)| *id == generation) {
                            *child = None;
                        }
                    }
                    if is_current && !state.exiting.load(Ordering::SeqCst) {
                        let stderr = state
                            .last_stderr
                            .lock()
                            .expect("backend stderr lock")
                            .trim()
                            .to_owned();
                        let reason = if stderr.is_empty() {
                            format!("本地代理已退出（状态：{:?}）", status.code)
                        } else {
                            format!("本地代理启动失败：\n{stderr}")
                        };
                        set_failed(
                            &state,
                            format!("{reason}\n日志文件：{}", log_path.display()),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

async fn stop_backend(state: Arc<BackendState>) {
    let child = state.child.lock().expect("backend child lock").take();
    if let Some((_, mut child)) = child {
        let _ = child.write(b"shutdown\n");
        std::thread::sleep(Duration::from_secs(2));
        let _ = child.kill();
    }
}

#[tauri::command]
async fn restart_backend<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Arc<BackendState>>,
) -> Result<(), String> {
    let shared = state.inner().clone();
    stop_backend(shared.clone()).await;
    start_backend(app, shared.clone()).map_err(|error| {
        shared.starting.store(false, Ordering::SeqCst);
        set_failed(&shared, error.clone());
        error
    })
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let backend = BackendState::new();
    let backend_for_setup = backend.clone();
    tauri::Builder::default()
        .manage(backend)
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app)
        }))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            backend_status,
            restart_backend
        ])
        .setup(move |app| {
            let open = MenuItem::with_id(app, "open", "打开 Wow", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let state_for_menu = backend_for_setup.clone();
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("default window icon")
                        .clone(),
                )
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => {
                        state_for_menu.exiting.store(true, Ordering::SeqCst);
                        let app = app.clone();
                        let state = state_for_menu.clone();
                        tauri::async_runtime::spawn(async move {
                            stop_backend(state).await;
                            app.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            if let Err(error) = start_backend(app.handle().clone(), backend_for_setup.clone()) {
                backend_for_setup.starting.store(false, Ordering::SeqCst);
                set_failed(&backend_for_setup, error);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<BackendState>>();
                if !state.exiting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Wow");
}
