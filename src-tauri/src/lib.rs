use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::ErrorKind;
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendSnapshot {
    state: String,
    base_url: String,
    error: String,
}

#[derive(Deserialize)]
struct ReadyPayload {
    port: u16,
}

#[derive(Deserialize)]
struct StoredAccount {
    platform: Option<serde_json::Value>,
    name: Option<serde_json::Value>,
    api_access_key: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAccountSummary {
    platform: String,
    name: String,
    api_access_key: String,
}

impl BackendSnapshot {
    fn starting() -> Self {
        Self {
            state: "starting".into(),
            base_url: String::new(),
            error: String::new(),
        }
    }
}

struct BackendState {
    snapshot: Mutex<BackendSnapshot>,
    child: Mutex<Option<(u64, CommandChild)>>,
    generation: AtomicU64,
    starting: AtomicBool,
    exiting: AtomicBool,
}

impl BackendState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshot: Mutex::new(BackendSnapshot::starting()),
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
            starting: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
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

#[tauri::command]
fn list_accounts<R: Runtime>(app: AppHandle<R>) -> Result<Vec<DesktopAccountSummary>, String> {
    let file_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("data")
        .join("accounts.json");
    let content = match std::fs::read_to_string(file_path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("读取账号列表失败：{error}")),
    };
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let accounts: Vec<StoredAccount> =
        serde_json::from_str(&content).map_err(|error| format!("账号配置格式错误：{error}"))?;
    let mut key_counts = HashMap::<String, usize>::new();
    for account in &accounts {
        let key = account
            .api_access_key
            .as_ref()
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .trim();
        if !key.is_empty() {
            *key_counts.entry(key.to_owned()).or_default() += 1;
        }
    }
    Ok(accounts
        .into_iter()
        .enumerate()
        .filter_map(|(index, account)| {
            let api_access_key = account.api_access_key?.as_str()?.trim().to_owned();
            if api_access_key.is_empty() || key_counts.get(&api_access_key) != Some(&1) {
                return None;
            }
            let platform_value = account.platform?.as_str()?.trim().to_ascii_lowercase();
            let platform = match platform_value.as_str() {
                "qq" | "qqmusic" => "qq".to_owned(),
                "netease" => "netease".to_owned(),
                _ => return None,
            };
            let name = account
                .name
                .and_then(|value| value.as_str().map(ToOwned::to_owned))
                .unwrap_or_default()
                .trim()
                .to_owned();
            Some(DesktopAccountSummary {
                name: if name.is_empty() {
                    format!("{}-{}", platform, index + 1)
                } else {
                    name
                },
                platform,
                api_access_key,
            })
        })
        .collect())
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
    *state.snapshot.lock().expect("backend snapshot lock") = BackendSnapshot {
        state: "failed".into(),
        base_url: String::new(),
        error: message,
    };
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
    let script = runtime_script(&app)?;
    let command = app
        .shell()
        .sidecar("node")
        .map_err(|error| error.to_string())?
        .arg(script.to_string_lossy().to_string())
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
                    let line = String::from_utf8_lossy(&bytes);
                    if state.generation.load(Ordering::SeqCst) == generation {
                        if let Some(payload) = line.trim().strip_prefix("WOW_ORIGIN_READY:") {
                            if let Ok(ReadyPayload { port }) = serde_json::from_str(payload) {
                                *state.snapshot.lock().expect("backend snapshot lock") =
                                    BackendSnapshot {
                                        state: "ready".into(),
                                        base_url: format!("http://127.0.0.1:{port}"),
                                        error: String::new(),
                                    };
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("{}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(error) => {
                    if state.generation.load(Ordering::SeqCst) == generation {
                        set_failed(&state, error);
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
                        set_failed(&state, format!("本地代理已退出（状态：{:?}）", status.code));
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
            list_accounts,
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
