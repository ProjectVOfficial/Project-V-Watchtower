#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use keyring::Entry;
use reqwest::Url;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, RunEvent, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::WindowEvent;
#[cfg(feature = "updater")]
use tauri_plugin_updater::UpdaterExt;

const DEFAULT_LOCAL_API_PORT: u16 = 46123;
const KEYRING_SERVICE: &str = "project-v-watchtower";
const LEGACY_KEYRING_SERVICE: &str = "world-monitor";
const LOCAL_API_LOG_FILE: &str = "local-api.log";
const DESKTOP_LOG_FILE: &str = "desktop.log";
const TRUSTED_WINDOWS: [&str; 11] = ["main", "settings", "live-channels", "case-desk", "data-desk", "map-operations", "assistant-desk", "analysis-room", "launch-desk", "camera-desk", "osint-desk"];
const SUPPORTED_SECRET_KEYS: [&str; 26] = [
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "FRED_API_KEY",
    "EIA_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "ACLED_ACCESS_TOKEN",
    "URLHAUS_AUTH_KEY",
    "OTX_API_KEY",
    "ABUSEIPDB_API_KEY",
    "WINGBITS_API_KEY",
    "WS_RELAY_URL",
    "VITE_OPENSKY_RELAY_URL",
    "OPENSKY_CLIENT_ID",
    "OPENSKY_CLIENT_SECRET",
    "AISSTREAM_API_KEY",
    "VITE_WS_RELAY_URL",
    "FINNHUB_API_KEY",
    "NASA_FIRMS_API_KEY",
    "UC_DP_KEY",
    "OLLAMA_API_URL",
    "OLLAMA_MODEL",
    "WATCHTOWER_ACCESS_KEY",
    "WORLDMONITOR_API_KEY",
    "WTO_API_KEY",
    "AVIATIONSTACK_API",
    "ICAO_API_KEY",
];

#[derive(Default)]
struct LocalApiState {
    child: Mutex<Option<Child>>,
    token: Mutex<Option<String>>,
    port: Mutex<Option<u16>>,
}

/// In-memory cache for keychain secrets. Populated once at startup to avoid
/// repeated macOS Keychain prompts (each `Entry::get_password()` triggers one).
struct SecretsCache {
    secrets: Mutex<HashMap<String, String>>,
}

/// In-memory mirror of persistent-cache.json. The file can grow to 10+ MB,
/// so reading/parsing/writing it on every IPC call blocks the main thread.
/// Instead, load once into RAM and serialize writes to preserve ordering.
struct PersistentCache {
    data: Mutex<Map<String, Value>>,
    dirty: Mutex<bool>,
    write_lock: Mutex<()>,
}

impl SecretsCache {
    fn parse_vault(json: &str) -> Option<HashMap<String, String>> {
        serde_json::from_str::<HashMap<String, String>>(json)
            .ok()
            .map(|map| {
                map.into_iter()
                    .filter(|(key, value)| {
                        SUPPORTED_SECRET_KEYS.contains(&key.as_str()) && !value.trim().is_empty()
                    })
                    .map(|(key, value)| (key, value.trim().to_string()))
                    .collect()
            })
    }

    fn read_consolidated(service: &str) -> Option<HashMap<String, String>> {
        let entry = Entry::new(service, "secrets-vault").ok()?;
        let json = entry.get_password().ok()?;
        Self::parse_vault(&json)
    }

    fn write_consolidated(service: &str, secrets: &HashMap<String, String>) -> bool {
        let Ok(json) = serde_json::to_string(secrets) else {
            return false;
        };
        let Ok(entry) = Entry::new(service, "secrets-vault") else {
            return false;
        };
        entry.set_password(&json).is_ok()
    }

    fn load_from_keychain() -> Self {
        // Phase Ten uses a Project V-specific credential service. Existing
        // World Monitor credentials are migrated without exposing them to JS.
        if let Some(secrets) = Self::read_consolidated(KEYRING_SERVICE) {
            return SecretsCache {
                secrets: Mutex::new(secrets),
            };
        }

        if let Some(secrets) = Self::read_consolidated(LEGACY_KEYRING_SERVICE) {
            if Self::write_consolidated(KEYRING_SERVICE, &secrets) {
                if let Ok(entry) = Entry::new(LEGACY_KEYRING_SERVICE, "secrets-vault") {
                    let _ = entry.delete_credential();
                }
            }
            return SecretsCache {
                secrets: Mutex::new(secrets),
            };
        }

        // Migration: read any legacy per-key entries from either service,
        // consolidate them into the Project V vault, then clean up only after
        // the new vault write succeeds.
        let mut secrets = HashMap::new();
        for service in [KEYRING_SERVICE, LEGACY_KEYRING_SERVICE] {
            for key in SUPPORTED_SECRET_KEYS.iter() {
                if secrets.contains_key(*key) {
                    continue;
                }
                if let Ok(entry) = Entry::new(service, key) {
                    if let Ok(value) = entry.get_password() {
                        let trimmed = value.trim().to_string();
                        if !trimmed.is_empty() {
                            secrets.insert((*key).to_string(), trimmed);
                        }
                    }
                }
            }
        }

        if !secrets.is_empty() && Self::write_consolidated(KEYRING_SERVICE, &secrets) {
            for service in [KEYRING_SERVICE, LEGACY_KEYRING_SERVICE] {
                for key in SUPPORTED_SECRET_KEYS.iter() {
                    if let Ok(entry) = Entry::new(service, key) {
                        let _ = entry.delete_credential();
                    }
                }
            }
        }

        SecretsCache {
            secrets: Mutex::new(secrets),
        }
    }
}

impl PersistentCache {
    fn load(path: &Path) -> Self {
        let data = if path.exists() {
            std::fs::read_to_string(path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default()
        } else {
            Map::new()
        };
        PersistentCache {
            data: Mutex::new(data),
            dirty: Mutex::new(false),
            write_lock: Mutex::new(()),
        }
    }

    fn get(&self, key: &str) -> Option<Value> {
        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        data.get(key).cloned()
    }

    /// Flush to disk only if dirty. Returns Ok(true) if written.
    fn flush(&self, path: &Path) -> Result<bool, String> {
        let _write_guard = self.write_lock.lock().unwrap_or_else(|e| e.into_inner());

        let is_dirty = {
            let dirty = self.dirty.lock().unwrap_or_else(|e| e.into_inner());
            *dirty
        };
        if !is_dirty {
            return Ok(false);
        }

        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let serialized = serde_json::to_string(&Value::Object(data.clone()))
            .map_err(|e| format!("Failed to serialize cache: {e}"))?;
        drop(data);
        std::fs::write(path, serialized)
            .map_err(|e| format!("Failed to write cache {}: {e}", path.display()))?;
        let mut dirty = self.dirty.lock().unwrap_or_else(|e| e.into_inner());
        *dirty = false;
        Ok(true)
    }
}

#[derive(Serialize)]
struct LaunchApplicationResult {
    pid: u32,
    executable: String,
}

#[derive(Serialize)]
struct DesktopRuntimeInfo {
    os: String,
    arch: String,
    local_api_port: Option<u16>,
    distribution_mode: String,
}

#[derive(Serialize)]
struct ProjectVUpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    published_at: Option<String>,
}


fn save_vault(cache: &HashMap<String, String>) -> Result<(), String> {
    let json =
        serde_json::to_string(cache).map_err(|e| format!("Failed to serialize vault: {e}"))?;
    let entry = Entry::new(KEYRING_SERVICE, "secrets-vault")
        .map_err(|e| format!("Keyring init failed: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("Failed to write vault: {e}"))?;
    Ok(())
}

fn generate_local_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("OS CSPRNG unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn require_trusted_window(label: &str) -> Result<(), String> {
    if TRUSTED_WINDOWS.contains(&label) {
        Ok(())
    } else {
        Err(format!("Command not allowed from window '{label}'"))
    }
}

#[cfg(windows)]
fn recognize_windows_speech_blocking(language: &str) -> Result<String, String> {
    let safe_language: String = language
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(24)
        .collect();
    let culture = if safe_language.is_empty() { "en-US" } else { safe_language.as_str() };
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$culture = [System.Globalization.CultureInfo]::GetCultureInfo('{culture}')
try {{ $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture) }}
catch {{ $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine }}
$recognizer.SetInputToDefaultAudioDevice()
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$result = $recognizer.Recognize([TimeSpan]::FromSeconds(15))
if ($null -ne $result) {{ [Console]::Out.Write($result.Text) }}"#,
    );
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    command.creation_flags(0x08000000);
    let output = command
        .output()
        .map_err(|error| format!("Failed to start Windows speech recognition: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "Windows speech recognition failed. Confirm that a microphone and matching speech language are installed.".to_string()
        } else {
            format!("Windows speech recognition failed: {detail}")
        });
    }
    let transcript = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if transcript.is_empty() {
        Err("No speech was detected before the fifteen-second timeout.".to_string())
    } else {
        Ok(transcript)
    }
}

#[tauri::command]
async fn recognize_windows_speech(webview: Webview, language: Option<String>) -> Result<String, String> {
    require_trusted_window(webview.label())?;
    #[cfg(windows)]
    {
        let language = language.unwrap_or_else(|| "en-US".to_string());
        return tauri::async_runtime::spawn_blocking(move || recognize_windows_speech_blocking(&language))
            .await
            .map_err(|error| format!("Windows speech recognition task failed: {error}"))?;
    }
    #[cfg(not(windows))]
    {
        let _ = language;
        Err("Native speech recognition fallback is currently available only on Windows.".to_string())
    }
}

#[tauri::command]
fn get_local_api_token(webview: Webview, state: tauri::State<'_, LocalApiState>) -> Result<String, String> {
    require_trusted_window(webview.label())?;
    let token = state
        .token
        .lock()
        .map_err(|_| "Failed to lock local API token".to_string())?;
    token
        .clone()
        .ok_or_else(|| "Token not generated".to_string())
}

#[tauri::command]
fn get_desktop_runtime_info(state: tauri::State<'_, LocalApiState>) -> DesktopRuntimeInfo {
    let port = state.port.lock().ok().and_then(|g| *g);
    DesktopRuntimeInfo {
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        local_api_port: port,
        distribution_mode: distribution_mode().to_string(),
    }
}

#[tauri::command]
fn get_local_api_port(webview: Webview, state: tauri::State<'_, LocalApiState>) -> Result<u16, String> {
    require_trusted_window(webview.label())?;
    state.port.lock()
        .map_err(|_| "Failed to lock port state".to_string())?
        .ok_or_else(|| "Port not yet assigned".to_string())
}

#[tauri::command]
fn list_supported_secret_keys() -> Vec<String> {
    SUPPORTED_SECRET_KEYS
        .iter()
        .map(|key| (*key).to_string())
        .collect()
}

#[tauri::command]
fn get_secret(
    webview: Webview,
    key: String,
    cache: tauri::State<'_, SecretsCache>,
) -> Result<Option<String>, String> {
    require_trusted_window(webview.label())?;
    if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported secret key: {key}"));
    }
    let secrets = cache
        .secrets
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    Ok(secrets.get(&key).cloned())
}

#[tauri::command]
fn get_all_secrets(webview: Webview, cache: tauri::State<'_, SecretsCache>) -> Result<HashMap<String, String>, String> {
    require_trusted_window(webview.label())?;
    Ok(cache
        .secrets
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone())
}

#[tauri::command]
fn set_secret(
    webview: Webview,
    key: String,
    value: String,
    cache: tauri::State<'_, SecretsCache>,
) -> Result<(), String> {
    require_trusted_window(webview.label())?;
    if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported secret key: {key}"));
    }
    let mut secrets = cache
        .secrets
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    let trimmed = value.trim().to_string();
    // Build proposed state, persist first, then commit to cache
    let mut proposed = secrets.clone();
    if trimmed.is_empty() {
        proposed.remove(&key);
    } else {
        proposed.insert(key, trimmed);
    }
    save_vault(&proposed)?;
    *secrets = proposed;
    Ok(())
}

#[tauri::command]
fn delete_secret(webview: Webview, key: String, cache: tauri::State<'_, SecretsCache>) -> Result<(), String> {
    require_trusted_window(webview.label())?;
    if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported secret key: {key}"));
    }
    let mut secrets = cache
        .secrets
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    let mut proposed = secrets.clone();
    proposed.remove(&key);
    save_vault(&proposed)?;
    *secrets = proposed;
    Ok(())
}

fn portable_root() -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let directory = executable.parent()?.to_path_buf();
    if directory.join("portable.flag").exists() || env::var("PROJECT_V_PORTABLE").ok().as_deref() == Some("1") {
        Some(directory)
    } else {
        None
    }
}

fn distribution_mode() -> &'static str {
    if cfg!(debug_assertions) {
        "development"
    } else if portable_root().is_some() {
        "portable"
    } else {
        "installed"
    }
}

fn project_v_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = if let Some(root) = portable_root() {
        root.join("ProjectVData")
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
    };
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory {}: {e}", dir.display()))?;
    Ok(dir)
}

fn cache_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(project_v_data_dir(app)?.join("persistent-cache.json"))
}

#[tauri::command]
fn read_cache_entry(webview: Webview, cache: tauri::State<'_, PersistentCache>, key: String) -> Result<Option<Value>, String> {
    require_trusted_window(webview.label())?;
    Ok(cache.get(&key))
}

#[tauri::command]
fn delete_cache_entry(webview: Webview, cache: tauri::State<'_, PersistentCache>, key: String) -> Result<(), String> {
    require_trusted_window(webview.label())?;
    {
        let mut data = cache.data.lock().unwrap_or_else(|e| e.into_inner());
        data.remove(&key);
    }
    {
        let mut dirty = cache.dirty.lock().unwrap_or_else(|e| e.into_inner());
        *dirty = true;
    }
    // Disk flush deferred to exit handler (cache.flush) — avoids blocking main thread
    Ok(())
}

#[tauri::command]
fn write_cache_entry(webview: Webview, app: AppHandle, cache: tauri::State<'_, PersistentCache>, key: String, value: String) -> Result<(), String> {
    require_trusted_window(webview.label())?;
    let parsed_value: Value = serde_json::from_str(&value)
        .map_err(|e| format!("Invalid cache payload JSON: {e}"))?;
    let _write_guard = cache.write_lock.lock().unwrap_or_else(|e| e.into_inner());
    {
        let mut data = cache.data.lock().unwrap_or_else(|e| e.into_inner());
        data.insert(key, parsed_value);
    }
    {
        let mut dirty = cache.dirty.lock().unwrap_or_else(|e| e.into_inner());
        *dirty = true;
    }

    // Flush synchronously under write lock so concurrent writes cannot reorder.
    let path = cache_file_path(&app)?;
    let data = cache.data.lock().unwrap_or_else(|e| e.into_inner());
    let serialized = serde_json::to_string(&Value::Object(data.clone()))
        .map_err(|e| format!("Failed to serialize cache: {e}"))?;
    drop(data);
    std::fs::write(&path, &serialized)
        .map_err(|e| format!("Failed to write cache {}: {e}", path.display()))?;
    {
        let mut dirty = cache.dirty.lock().unwrap_or_else(|e| e.into_inner());
        *dirty = false;
    }
    Ok(())
}

fn logs_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = if let Some(root) = portable_root() {
        root.join("ProjectVData").join("logs")
    } else {
        app.path()
            .app_log_dir()
            .map_err(|e| format!("Failed to resolve app log dir: {e}"))?
    };
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app log dir {}: {e}", dir.display()))?;
    Ok(dir)
}

fn sidecar_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(logs_dir_path(app)?.join(LOCAL_API_LOG_FILE))
}

fn desktop_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(logs_dir_path(app)?.join(DESKTOP_LOG_FILE))
}

fn append_desktop_log(app: &AppHandle, level: &str, message: &str) {
    let Ok(path) = desktop_log_path(app) else {
        return;
    };

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(file, "[{timestamp}][{level}] {message}");
}

fn open_in_shell(arg: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(arg);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(arg);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(arg);
        cmd.env_remove("LD_LIBRARY_PATH");
        cmd.env_remove("LD_PRELOAD");
        cmd
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open {}: {e}", arg))
}

fn open_url_in_shell(arg: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `explorer.exe <url>` can display an "Application not found" dialog on
        // systems whose HTTP association is unusual. FileProtocolHandler asks
        // Windows to resolve the registered HTTPS handler directly.
        return Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(arg)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open {arg}: {error}"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        open_in_shell(arg)
    }
}

fn open_path_in_shell(path: &Path) -> Result<(), String> {
    open_in_shell(&path.to_string_lossy())
}

fn picker_output(mut command: Command, description: &str) -> Result<Option<String>, String> {
    let output = command
        .output()
        .map_err(|error| format!("Failed to open {description}: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("{description} closed without a selection")
        } else {
            format!("{description} failed: {detail}")
        });
    }
    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if selected.is_empty() { None } else { Some(selected) })
}

#[tauri::command]
fn select_application_executable(webview: Webview) -> Result<Option<String>, String> {
    require_trusted_window(webview.label())?;

    #[cfg(windows)]
    {
        let script = r#"Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select an approved application executable'
$dialog.Filter = 'Applications (*.exe)|*.exe'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }"#;
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script]);
        command.creation_flags(0x08000000);
        return picker_output(command, "application picker");
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("osascript");
        command.args(["-e", "POSIX path of (choose file with prompt \"Select an approved application executable\")"]);
        return picker_output(command, "application picker");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = Command::new("zenity");
        command.args(["--file-selection", "--title=Select an approved application executable"]);
        return picker_output(command, "application picker");
    }
}

#[tauri::command]
fn select_launch_handoff_file(webview: Webview) -> Result<Option<String>, String> {
    require_trusted_window(webview.label())?;

    #[cfg(windows)]
    {
        let script = r#"Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select a file to hand off to the approved application'
$dialog.Filter = 'All files (*.*)|*.*'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }"#;
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script]);
        command.creation_flags(0x08000000);
        return picker_output(command, "file picker");
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("osascript");
        command.args(["-e", "POSIX path of (choose file with prompt \"Select a file to open\")"]);
        return picker_output(command, "file picker");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = Command::new("zenity");
        command.args(["--file-selection", "--title=Select a file to open"]);
        return picker_output(command, "file picker");
    }
}

fn canonical_existing_file(raw: &str, label: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err(format!("{label} is required"));
    }
    let path = fs::canonicalize(PathBuf::from(raw.trim()))
        .map_err(|error| format!("Unable to resolve {label}: {error}"))?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Unable to inspect {label}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("{label} must be a file"));
    }
    Ok(path)
}

#[tauri::command]
fn launch_approved_application(
    webview: Webview,
    path: String,
    arguments: Vec<String>,
    working_directory: Option<String>,
    handoff: Option<String>,
) -> Result<LaunchApplicationResult, String> {
    require_trusted_window(webview.label())?;
    let executable = canonical_existing_file(&path, "application executable")?;

    #[cfg(windows)]
    {
        let extension = executable.extension().and_then(|value| value.to_str()).unwrap_or_default();
        if !extension.eq_ignore_ascii_case("exe") {
            return Err("Only .exe application files can be registered on Windows".to_string());
        }
        let filename = executable.file_name().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        let blocked_hosts = [
            "cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "cscript.exe",
            "mshta.exe", "rundll32.exe", "regsvr32.exe",
        ];
        if blocked_hosts.contains(&filename.as_str()) {
            return Err("Command shells and Windows script hosts cannot be registered in Launch Deck".to_string());
        }
    }

    if arguments.len() > 32 || arguments.iter().any(|argument| argument.len() > 2048 || argument.contains('\0')) {
        return Err("Application arguments exceeded the safe Launch Deck limits".to_string());
    }

    let mut command = Command::new(&executable);
    command.args(arguments.iter());

    if let Some(value) = handoff.filter(|value| !value.trim().is_empty()) {
        let trimmed = value.trim();
        if let Ok(url) = Url::parse(trimmed) {
            let local_http = url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1") | Some("::1"));
            if url.scheme() != "https" && !local_http {
                return Err("Only HTTPS URL handoffs are allowed (HTTP only for localhost)".to_string());
            }
            command.arg(url.as_str());
        } else {
            let file = canonical_existing_file(trimmed, "handoff file")?;
            command.arg(file);
        }
    }

    if let Some(directory) = working_directory.filter(|value| !value.trim().is_empty()) {
        let resolved = fs::canonicalize(PathBuf::from(directory.trim()))
            .map_err(|error| format!("Unable to resolve working directory: {error}"))?;
        if !resolved.is_dir() {
            return Err("Working directory must be a directory".to_string());
        }
        command.current_dir(resolved);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start {}: {error}", executable.display()))?;
    Ok(LaunchApplicationResult {
        pid: child.id(),
        executable: executable.display().to_string(),
    })
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;

    match parsed.scheme() {
        "https" => open_url_in_shell(parsed.as_str()),
        "http" => match parsed.host_str() {
            Some("localhost") | Some("127.0.0.1") => open_url_in_shell(parsed.as_str()),
            _ => Err("Only https:// URLs are allowed (http:// only for localhost)".to_string()),
        },
        _ => Err("Only https:// URLs are allowed (http:// only for localhost)".to_string()),
    }
}

fn open_logs_folder_impl(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = logs_dir_path(app)?;
    open_path_in_shell(&dir)?;
    Ok(dir)
}

fn open_sidecar_log_impl(app: &AppHandle) -> Result<PathBuf, String> {
    let log_path = sidecar_log_path(app)?;
    if !log_path.exists() {
        File::create(&log_path)
            .map_err(|e| format!("Failed to create sidecar log {}: {e}", log_path.display()))?;
    }
    open_path_in_shell(&log_path)?;
    Ok(log_path)
}

#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<String, String> {
    open_logs_folder_impl(&app).map(|path| path.display().to_string())
}

#[tauri::command]
fn open_sidecar_log_file(app: AppHandle) -> Result<String, String> {
    open_sidecar_log_impl(&app).map(|path| path.display().to_string())
}

#[tauri::command]
async fn open_settings_window_command(app: AppHandle) -> Result<(), String> {
    open_settings_window(&app)
}

#[tauri::command]
fn close_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window
            .close()
            .map_err(|e| format!("Failed to close settings window: {e}"))?;
    }
    Ok(())
}

/// Preserves the development-tools shortcut after removing the native
/// File/Edit/Help menu. Release builds intentionally reject this command.
#[tauri::command]
fn toggle_developer_tools(window: WebviewWindow) -> Result<bool, String> {
    require_trusted_window(window.label())?;

    #[cfg(feature = "devtools")]
    {
        if window.is_devtools_open() {
            window.close_devtools();
            Ok(false)
        } else {
            window.open_devtools();
            Ok(true)
        }
    }

    #[cfg(not(feature = "devtools"))]
    {
        Err("Developer tools are available only in desktop development builds".to_string())
    }
}

#[tauri::command]
async fn open_live_channels_window_command(
    app: AppHandle,
    base_url: Option<String>,
) -> Result<(), String> {
    open_live_channels_window(&app, base_url)
}

#[tauri::command]
fn close_live_channels_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("live-channels") {
        window
            .close()
            .map_err(|e| format!("Failed to close live channels window: {e}"))?;
    }
    Ok(())
}

fn open_project_v_workspace_window(
    app: &AppHandle,
    label: &str,
    page: &str,
    title: &str,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    let query_string = query.unwrap_or_default();
    if let Some(window) = app.get_webview_window(label) {
        if query_string.trim().is_empty() {
            let _ = window.show();
            window.set_focus().map_err(|e| format!("Failed to focus {title}: {e}"))?;
            return Ok(());
        }
        let _ = window.close();
    }

    let suffix = if query_string.trim().is_empty() {
        String::new()
    } else {
        format!("?{}", query_string.trim_start_matches('?'))
    };
    let url = match base_url {
        Some(origin) if !origin.trim().is_empty() => {
            let full = format!("{}/{}{}", origin.trim_end_matches('/'), page, suffix);
            WebviewUrl::External(Url::parse(&full).map_err(|_| format!("Invalid {title} development URL"))?)
        }
        _ => WebviewUrl::App(format!("{page}{suffix}").into()),
    };

    let window = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(1420.0, 900.0)
        .min_inner_size(980.0, 680.0)
        .resizable(true)
        .background_color(tauri::webview::Color(7, 6, 6, 255))
        .build()
        .map_err(|e| format!("Failed to create {title}: {e}"))?;

    #[cfg(not(target_os = "macos"))]
    let _ = window.remove_menu();
    Ok(())
}

#[tauri::command]
async fn open_case_desk_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "case-desk", "case-desk.html", "Project V // Case Desk", base_url, query)
}

#[tauri::command]
fn close_case_desk_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("case-desk") {
        window.close().map_err(|e| format!("Failed to close Case Desk: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_data_desk_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "data-desk", "data-desk.html", "Project V // Data Desk", base_url, query)
}

#[tauri::command]
fn close_data_desk_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("data-desk") {
        window.close().map_err(|e| format!("Failed to close Data Desk: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_map_operations_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "map-operations", "map-operations.html", "Project V // Map Operations", base_url, query)
}

#[tauri::command]
fn close_map_operations_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("map-operations") {
        window.close().map_err(|e| format!("Failed to close Map Operations: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_assistant_desk_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "assistant-desk", "assistant-desk.html", "Project V // Command Assistant", base_url, query)
}

#[tauri::command]
fn close_assistant_desk_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("assistant-desk") {
        window.close().map_err(|e| format!("Failed to close Command Assistant: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_analysis_room_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "analysis-room", "analysis-room.html", "Project V // Analysis Room", base_url, query)
}

#[tauri::command]
fn close_analysis_room_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("analysis-room") {
        window.close().map_err(|e| format!("Failed to close Analysis Room: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_launch_desk_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "launch-desk", "launch-desk.html", "Project V // Launch Desk", base_url, query)
}

#[tauri::command]
fn close_launch_desk_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("launch-desk") {
        window.close().map_err(|e| format!("Failed to close Launch Desk: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_camera_desk_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "camera-desk", "camera-desk.html", "Project V // Camera Wall", base_url, query)
}

#[tauri::command]
fn close_camera_desk_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("camera-desk") {
        window.close().map_err(|e| format!("Failed to close Camera Wall: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_osint_desk_window(
    app: AppHandle,
    base_url: Option<String>,
    query: Option<String>,
) -> Result<(), String> {
    open_project_v_workspace_window(&app, "osint-desk", "osint-desk.html", "Project V // OSINT Desk", base_url, query)
}

#[tauri::command]
fn close_osint_desk_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("osint-desk") {
        window.close().map_err(|e| format!("Failed to close OSINT Desk: {e}"))?;
    }
    Ok(())
}

/// Fetch JSON from Polymarket Gamma API using native TLS (bypasses Cloudflare JA3 blocking).
/// Called from frontend when browser CORS and sidecar Node.js TLS both fail.
#[tauri::command]
async fn fetch_polymarket(webview: Webview, path: String, params: String) -> Result<String, String> {
    require_trusted_window(webview.label())?;
    let allowed = ["events", "markets", "tags"];
    let segment = path.trim_start_matches('/');
    if !allowed.iter().any(|a| segment.starts_with(a)) {
        return Err("Invalid Polymarket path".into());
    }
    let url = format!("https://gamma-api.polymarket.com/{}?{}", segment, params);
    let client = reqwest::Client::builder()
        .use_native_tls()
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Polymarket fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Polymarket HTTP {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("Read body failed: {e}"))
}

fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus settings window: {e}"))?;
        return Ok(());
    }

    let _settings_window = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Project V Watchtower Settings")
        .inner_size(980.0, 600.0)
        .min_inner_size(820.0, 480.0)
        .resizable(true)
        .background_color(tauri::webview::Color(26, 28, 30, 255))
        .build()
        .map_err(|e| format!("Failed to create settings window: {e}"))?;

    // On Windows/Linux, menus are per-window. Remove the inherited app menu
    // from the settings window (macOS uses a shared app-wide menu bar instead).
    #[cfg(not(target_os = "macos"))]
    let _ = _settings_window.remove_menu();

    Ok(())
}

fn open_live_channels_window(app: &AppHandle, base_url: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("live-channels") {
        let _ = window.show();
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus live channels window: {e}"))?;
        return Ok(());
    }

    // In dev, use the same origin as the main window (e.g. http://localhost:3001) so we don't
    // get "connection refused" when Vite runs on a different port than devUrl.
    let url = match base_url {
        Some(ref origin) if !origin.is_empty() => {
            let path = origin.trim_end_matches('/');
            let full_url = format!("{}/live-channels.html", path);
            WebviewUrl::External(Url::parse(&full_url).map_err(|_| "Invalid base URL".to_string())?)
        }
        _ => WebviewUrl::App("live-channels.html".into()),
    };

    let _live_channels_window = WebviewWindowBuilder::new(app, "live-channels", url)
    .title("Channel Management // Watchtower")
    .inner_size(680.0, 760.0)
    .min_inner_size(520.0, 600.0)
    .resizable(true)
    .background_color(tauri::webview::Color(26, 28, 30, 255))
    .build()
    .map_err(|e| format!("Failed to create live channels window: {e}"))?;

    #[cfg(not(target_os = "macos"))]
    let _ = _live_channels_window.remove_menu();

    Ok(())
}

fn open_youtube_login_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("youtube-login") {
        let _ = window.show();
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus YouTube login window: {e}"))?;
        return Ok(());
    }

    let url = WebviewUrl::External(
        Url::parse("https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/")
            .map_err(|e| format!("Invalid URL: {e}"))?
    );

    let _yt_window = WebviewWindowBuilder::new(app, "youtube-login", url)
        .title("Sign in to YouTube")
        .inner_size(500.0, 700.0)
        .resizable(true)
        .build()
        .map_err(|e| format!("Failed to create YouTube login window: {e}"))?;

    #[cfg(not(target_os = "macos"))]
    let _ = _yt_window.remove_menu();

    Ok(())
}

#[tauri::command]
async fn open_youtube_login(app: AppHandle) -> Result<(), String> {
    open_youtube_login_window(&app)
}

fn clean_window_title(value: &str, fallback: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn communication_host_allowed(host: &str) -> bool {
    matches!(
        host,
        "voice.google.com"
            | "discord.com"
            | "app.slack.com"
            | "web.telegram.org"
            | "messages.google.com"
            | "meet.google.com"
            | "mail.google.com"
            | "teams.microsoft.com"
            | "web.whatsapp.com"
    )
}

#[tauri::command]
async fn open_communications_window(
    app: AppHandle,
    service: String,
    url: String,
    title: String,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid communications URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Communications windows require HTTPS".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Communications URL is missing a host".to_string())?;
    if !communication_host_allowed(host) {
        return Err(format!("Integrated communications host is not approved: {host}"));
    }
    let slug: String = service
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(48)
        .collect();
    if slug.is_empty() {
        return Err("Invalid communications service identifier".to_string());
    }
    let label = format!("communications-{slug}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        window
            .set_focus()
            .map_err(|error| format!("Failed to focus communications window: {error}"))?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed))
        .title(clean_window_title(&title, "Project V Communications"))
        .inner_size(1080.0, 760.0)
        .min_inner_size(720.0, 520.0)
        .resizable(true)
        .build()
        .map_err(|error| format!("Failed to create communications window: {error}"))?;

    #[cfg(not(target_os = "macos"))]
    let _ = window.remove_menu();

    Ok(())
}

fn normalized_communications_dock_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    (
        LogicalPosition::new(x.max(0.0).round(), y.max(0.0).round()),
        LogicalSize::new(width.max(240.0).round(), height.max(180.0).round()),
    )
}

#[tauri::command]
async fn open_communications_dock(
    app: AppHandle,
    service: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid communications URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Communications dock requires HTTPS".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Communications URL is missing a host".to_string())?;
    if !communication_host_allowed(host) {
        return Err(format!("Integrated communications host is not approved: {host}"));
    }
    let slug: String = service
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(48)
        .collect();
    if slug.is_empty() {
        return Err("Invalid communications service identifier".to_string());
    }

    let (position, size) = normalized_communications_dock_bounds(x, y, width, height);
    if let Some(webview) = app.get_webview("communications-dock") {
        webview
            .navigate(parsed)
            .map_err(|error| format!("Failed to navigate communications dock: {error}"))?;
        webview
            .set_position(position)
            .map_err(|error| format!("Failed to position communications dock: {error}"))?;
        webview
            .set_size(size)
            .map_err(|error| format!("Failed to resize communications dock: {error}"))?;
        webview
            .show()
            .map_err(|error| format!("Failed to show communications dock: {error}"))?;
        let _ = webview.set_focus();
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main Watchtower window is unavailable".to_string())?;
    let builder = WebviewBuilder::new("communications-dock", WebviewUrl::External(parsed));
    let webview = window
        .add_child(builder, position, size)
        .map_err(|error| format!("Failed to create communications dock: {error}"))?;
    let _ = webview.set_focus();
    Ok(())
}

#[tauri::command]
async fn update_communications_dock(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let Some(webview) = app.get_webview("communications-dock") else {
        return Ok(());
    };
    if !visible {
        return webview
            .hide()
            .map_err(|error| format!("Failed to hide communications dock: {error}"));
    }
    let (position, size) = normalized_communications_dock_bounds(x, y, width, height);
    webview
        .set_position(position)
        .map_err(|error| format!("Failed to position communications dock: {error}"))?;
    webview
        .set_size(size)
        .map_err(|error| format!("Failed to resize communications dock: {error}"))?;
    webview
        .show()
        .map_err(|error| format!("Failed to show communications dock: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn hide_communications_dock(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("communications-dock") {
        webview
            .hide()
            .map_err(|error| format!("Failed to hide communications dock: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn reload_communications_dock(app: AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview("communications-dock")
        .ok_or_else(|| "No communications service is currently docked".to_string())?;
    webview
        .reload()
        .map_err(|error| format!("Failed to reload communications dock: {error}"))
}

#[tauri::command]
async fn close_communications_dock(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("communications-dock") {
        webview
            .close()
            .map_err(|error| format!("Failed to close communications dock: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_source_browser_window(app: AppHandle, url: String, title: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid source URL".to_string())?;
    let allowed = parsed.scheme() == "https"
        || (parsed.scheme() == "http"
            && matches!(parsed.host_str(), Some("localhost") | Some("127.0.0.1")));
    if !allowed {
        return Err("Source Browser permits HTTPS URLs and localhost HTTP only".to_string());
    }

    if let Some(window) = app.get_webview_window("source-browser-window") {
        let _ = window.close();
    }

    let window = WebviewWindowBuilder::new(
        &app,
        "source-browser-window",
        WebviewUrl::External(parsed),
    )
    .title(clean_window_title(&title, "Project V Source Browser"))
    .inner_size(1180.0, 800.0)
    .min_inner_size(760.0, 540.0)
    .resizable(true)
    .focused(true)
    .center()
    .build()
    .map_err(|error| format!("Failed to create source browser window: {error}"))?;

    #[cfg(not(target_os = "macos"))]
    let _ = window.remove_menu();
    let _ = window.show();
    window
        .set_focus()
        .map_err(|error| format!("Source browser opened but could not receive focus: {error}"))?;

    Ok(())
}

/// Strip Windows extended-length path prefixes that `canonicalize()` adds.
/// Preserve UNC semantics: `\\?\UNC\server\share\...` must become
/// `\\server\share\...` (not `UNC\server\share\...`).
fn sanitize_path_for_node(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(stripped_unc) = s.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{stripped_unc}")
    } else if let Some(stripped) = s.strip_prefix("\\\\?\\") {
        stripped.to_string()
    } else {
        s.into_owned()
    }
}

#[cfg(test)]
mod sanitize_path_tests {
    use super::sanitize_path_for_node;
    use std::path::Path;

    #[test]
    fn strips_extended_drive_prefix() {
        let raw = Path::new(r"\\?\C:\Program Files\nodejs\node.exe");
        assert_eq!(
            sanitize_path_for_node(raw),
            r"C:\Program Files\nodejs\node.exe".to_string()
        );
    }

    #[test]
    fn strips_extended_unc_prefix_and_preserves_unc_root() {
        let raw = Path::new(r"\\?\UNC\server\share\sidecar\local-api-server.mjs");
        assert_eq!(
            sanitize_path_for_node(raw),
            r"\\server\share\sidecar\local-api-server.mjs".to_string()
        );
    }

    #[test]
    fn leaves_standard_paths_unchanged() {
        let raw = Path::new(r"C:\Users\alice\sidecar\local-api-server.mjs");
        assert_eq!(
            sanitize_path_for_node(raw),
            r"C:\Users\alice\sidecar\local-api-server.mjs".to_string()
        );
    }
}

fn local_api_paths(app: &AppHandle) -> (PathBuf, PathBuf) {
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let sidecar_script = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar/local-api-server.mjs")
    } else {
        resource_dir.join("sidecar/local-api-server.mjs")
    };

    let api_dir_root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        let direct_api = resource_dir.join("api");
        let lifted_root = resource_dir.join("_up_");
        let lifted_api = lifted_root.join("api");
        if direct_api.exists() {
            resource_dir
        } else if lifted_api.exists() {
            lifted_root
        } else {
            resource_dir
        }
    };

    (sidecar_script, api_dir_root)
}

fn resolve_node_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(explicit) = env::var("LOCAL_API_NODE_BIN") {
        let explicit_path = PathBuf::from(explicit);
        if explicit_path.is_file() {
            return Some(explicit_path);
        }
        append_desktop_log(
            app,
            "WARN",
            &format!(
                "LOCAL_API_NODE_BIN is set but not a valid file: {}",
                explicit_path.display()
            ),
        );
    }

    if !cfg!(debug_assertions) {
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("sidecar").join("node").join(node_name);
            if bundled.is_file() {
                return Some(bundled);
            }
        }
    }

    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join(node_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    let common_locations = if cfg!(windows) {
        vec![
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
        ]
    } else {
        vec![
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
            PathBuf::from("/usr/bin/node"),
            PathBuf::from("/opt/local/bin/node"),
        ]
    };

    common_locations.into_iter().find(|path| path.is_file())
}

fn read_port_file(path: &Path, timeout_ms: u64) -> Option<u16> {
    let start = std::time::Instant::now();
    let interval = std::time::Duration::from_millis(100);
    let timeout = std::time::Duration::from_millis(timeout_ms);
    while start.elapsed() < timeout {
        if let Ok(contents) = fs::read_to_string(path) {
            if let Ok(port) = contents.trim().parse::<u16>() {
                if port > 0 {
                    return Some(port);
                }
            }
        }
        std::thread::sleep(interval);
    }
    None
}

fn start_local_api(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<LocalApiState>();
    let mut slot = state
        .child
        .lock()
        .map_err(|_| "Failed to lock local API state".to_string())?;
    if slot.is_some() {
        return Ok(());
    }

    // Clear port state for fresh start
    if let Ok(mut port_slot) = state.port.lock() {
        *port_slot = None;
    }

    let (script, resource_root) = local_api_paths(app);
    if !script.exists() {
        return Err(format!(
            "Local API sidecar script missing at {}",
            script.display()
        ));
    }
    let node_binary = resolve_node_binary(app).ok_or_else(|| {
        "Node.js executable not found. Install Node 18+ or set LOCAL_API_NODE_BIN".to_string()
    })?;

    let port_file = logs_dir_path(app)?.join("sidecar.port");
    let _ = fs::remove_file(&port_file);

    let log_path = sidecar_log_path(app)?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open local API log {}: {e}", log_path.display()))?;
    let log_file_err = log_file
        .try_clone()
        .map_err(|e| format!("Failed to clone local API log handle: {e}"))?;

    append_desktop_log(
        app,
        "INFO",
        &format!(
            "starting local API sidecar script={} resource_root={} log={}",
            script.display(),
            resource_root.display(),
            log_path.display()
        ),
    );
    append_desktop_log(
        app,
        "INFO",
        &format!("resolved node binary={}", node_binary.display()),
    );
    append_desktop_log(
        app,
        "INFO",
        &format!(
            "local API sidecar preferred port={} port_file={}",
            DEFAULT_LOCAL_API_PORT,
            port_file.display()
        ),
    );

    // Generate a unique token for local API auth (prevents other local processes from accessing sidecar)
    let mut token_slot = state
        .token
        .lock()
        .map_err(|_| "Failed to lock token slot")?;
    if token_slot.is_none() {
        *token_slot = Some(generate_local_token());
    }
    let local_api_token = token_slot.clone().unwrap();
    drop(token_slot);

    let mut cmd = Command::new(&node_binary);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW — hide the node.exe console
                                    // Sanitize paths for Node.js on Windows: strip \\?\ UNC prefix and set
                                    // explicit working directory to avoid bare drive-letter CWD issues that
                                    // cause EISDIR errors in Node.js module resolution.
    let script_for_node = sanitize_path_for_node(&script);
    let resource_for_node = sanitize_path_for_node(&resource_root);
    append_desktop_log(
        app,
        "INFO",
        &format!("node args: script={script_for_node} resource_dir={resource_for_node}"),
    );
    let data_dir = logs_dir_path(app)
        .map(|p| sanitize_path_for_node(&p))
        .unwrap_or_else(|_| resource_for_node.clone());
    cmd.arg(&script_for_node)
        .env("LOCAL_API_PORT", DEFAULT_LOCAL_API_PORT.to_string())
        .env("LOCAL_API_PORT_FILE", &port_file)
        .env("LOCAL_API_RESOURCE_DIR", &resource_for_node)
        .env("LOCAL_API_DATA_DIR", &data_dir)
        .env("LOCAL_API_MODE", "tauri-sidecar")
        .env("LOCAL_API_TOKEN", &local_api_token)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));
    if let Some(parent) = script.parent() {
        cmd.current_dir(parent);
    }

    // Pass cached keychain secrets to sidecar as env vars (no keychain re-read)
    let mut secret_count = 0u32;
    let secrets_cache = app.state::<SecretsCache>();
    if let Ok(secrets) = secrets_cache.secrets.lock() {
        for (key, value) in secrets.iter() {
            cmd.env(key, value);
            secret_count += 1;
        }
    }
    append_desktop_log(
        app,
        "INFO",
        &format!("injected {secret_count} keychain secrets into sidecar env"),
    );

    // Inject build-time secrets (CI) with runtime env fallback (dev)
    if let Some(url) = option_env!("CONVEX_URL") {
        cmd.env("CONVEX_URL", url);
    } else if let Ok(url) = std::env::var("CONVEX_URL") {
        cmd.env("CONVEX_URL", url);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch local API: {e}"))?;
    append_desktop_log(
        app,
        "INFO",
        &format!("local API sidecar started pid={}", child.id()),
    );
    *slot = Some(child);
    drop(slot);

    // Wait for sidecar to write confirmed port (up to 5s)
    if let Some(confirmed_port) = read_port_file(&port_file, 5000) {
        append_desktop_log(
            app,
            "INFO",
            &format!("sidecar confirmed port={confirmed_port}"),
        );
        if let Ok(mut port_slot) = state.port.lock() {
            *port_slot = Some(confirmed_port);
        }
    } else {
        append_desktop_log(
            app,
            "WARN",
            "sidecar port file not found within timeout, using default",
        );
        if let Ok(mut port_slot) = state.port.lock() {
            *port_slot = Some(DEFAULT_LOCAL_API_PORT);
        }
    }

    Ok(())
}

fn stop_local_api(app: &AppHandle) {
    if let Ok(state) = app.try_state::<LocalApiState>().ok_or(()) {
        if let Ok(mut slot) = state.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                append_desktop_log(app, "INFO", "local API sidecar stopped");
            }
        }
        if let Ok(mut port_slot) = state.port.lock() {
            *port_slot = None;
        }
        if let Ok(log_dir) = logs_dir_path(app) {
            let _ = fs::remove_file(log_dir.join("sidecar.port"));
        }
    }
}

#[cfg(target_os = "linux")]
fn resolve_appimage_gio_module_dir() -> Option<PathBuf> {
    let appdir = env::var_os("APPDIR")?;
    let appdir = PathBuf::from(appdir);

    // Common layouts produced by AppImage/linuxdeploy on Debian and RPM families.
    let preferred = [
        "usr/lib/gio/modules",
        "usr/lib64/gio/modules",
        "usr/lib/x86_64-linux-gnu/gio/modules",
        "usr/lib/aarch64-linux-gnu/gio/modules",
        "usr/lib/arm-linux-gnueabihf/gio/modules",
        "lib/gio/modules",
        "lib64/gio/modules",
    ];

    for relative in preferred {
        let candidate = appdir.join(relative);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    // Fallback: probe one level of arch-specific directories, e.g. usr/lib/<triplet>/gio/modules.
    for lib_root in ["usr/lib", "usr/lib64", "lib", "lib64"] {
        let root = appdir.join(lib_root);
        if !root.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let candidate = entry.path().join("gio/modules");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(feature = "updater")]
#[tauri::command]
async fn check_project_v_update(webview: Webview, app: AppHandle) -> Result<Option<ProjectVUpdateInfo>, String> {
    require_trusted_window(webview.label())?;
    if distribution_mode() == "portable" {
        return Ok(None);
    }
    let updater = app.updater().map_err(|error| format!("Updater is not configured: {error}"))?;
    let update = updater.check().await.map_err(|error| format!("Update check failed: {error}"))?;
    Ok(update.map(|item| ProjectVUpdateInfo {
        version: item.version,
        current_version: item.current_version,
        notes: item.body,
        published_at: item.date.map(|date| date.to_string()),
    }))
}

#[cfg(not(feature = "updater"))]
#[tauri::command]
async fn check_project_v_update(webview: Webview, _app: AppHandle) -> Result<Option<ProjectVUpdateInfo>, String> {
    require_trusted_window(webview.label())?;
    Ok(None)
}

#[cfg(feature = "updater")]
#[tauri::command]
async fn install_project_v_update(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_trusted_window(webview.label())?;
    if distribution_mode() == "portable" {
        return Err("Portable editions are updated by replacing the portable folder with a newer signed archive.".to_string());
    }
    let updater = app.updater().map_err(|error| format!("Updater is not configured: {error}"))?;
    let Some(update) = updater.check().await.map_err(|error| format!("Update check failed: {error}"))? else {
        return Err("No update is currently available.".to_string());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Update installation failed: {error}"))?;
    app.restart();
}

#[cfg(not(feature = "updater"))]
#[tauri::command]
async fn install_project_v_update(webview: Webview, _app: AppHandle) -> Result<(), String> {
    require_trusted_window(webview.label())?;
    Err("The updater is disabled in development and unsigned local builds.".to_string())
}

fn main() {
    // Work around WebKitGTK rendering issues on Linux that can cause blank white
    // screens. DMA-BUF renderer failures are common with NVIDIA drivers and on
    // immutable distros (e.g. Bazzite/Fedora Atomic).  Setting the env var before
    // WebKit initialises forces a software fallback path.  Only set when the user
    // hasn't explicitly configured the variable.
    #[cfg(target_os = "linux")]
    {
        if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            // SAFETY: called before any threads are spawned (Tauri hasn't started yet).
            unsafe { env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }

        // WebKitGTK promotes iframes, <video>, and canvas to GPU-textured
        // compositing layers.  In VMs (Apple Virtualization.framework,
        // QEMU/KVM, VMware, etc.) the virtio-gpu driver often only supports
        // 2D or limited GL — GBM buffer allocation for compositing layers
        // fails silently, rendering iframe/video content as black while the
        // main page (software-tiled) works fine.
        //
        // Detect VM environments via /proc/cpuinfo "hypervisor" flag or
        // sys_vendor strings and disable accelerated compositing + force
        // software GL so all content renders through the CPU path.
        let in_vm = std::fs::read_to_string("/proc/cpuinfo")
            .map(|c| c.contains("hypervisor"))
            .unwrap_or(false)
            || std::fs::read_to_string("/sys/class/dmi/id/sys_vendor")
                .map(|v| {
                    let v = v.trim().to_lowercase();
                    v.contains("qemu") || v.contains("vmware") || v.contains("virtualbox")
                        || v.contains("apple") || v.contains("parallels") || v.contains("xen")
                        || v.contains("microsoft") || v.contains("innotek")
                })
                .unwrap_or(false);

        if in_vm {
            if env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
                unsafe { env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1") };
            }
            if env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
                unsafe { env::set_var("LIBGL_ALWAYS_SOFTWARE", "1") };
            }
            eprintln!("[tauri] VM detected; disabled WebKitGTK accelerated compositing for iframe/video compatibility");
        }

        // NVIDIA proprietary drivers often fail to create a surfaceless EGL
        // display (EGL_BAD_ALLOC) in WebKitGTK's web process, especially on
        // Wayland where explicit sync can also cause flickering/crashes.
        // Detect NVIDIA by checking for /proc/driver/nvidia (created by
        // nvidia.ko) and apply Wayland-specific workarounds.
        let has_nvidia = std::path::Path::new("/proc/driver/nvidia").exists();
        if has_nvidia {
            if env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
                unsafe { env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1") };
            }
            // Force X11 backend on NVIDIA + Wayland to avoid surfaceless EGL
            // failures.  Users who prefer native Wayland can override with
            // GDK_BACKEND=wayland.
            if env::var_os("WAYLAND_DISPLAY").is_some() && env::var_os("GDK_BACKEND").is_none() {
                unsafe { env::set_var("GDK_BACKEND", "x11") };
                eprintln!(
                    "[tauri] NVIDIA GPU + Wayland detected; forcing GDK_BACKEND=x11 to avoid EGL_BAD_ALLOC. \
                     Set GDK_BACKEND=wayland to override."
                );
            }
        }

        // On Wayland-only compositors (e.g. niri, river, sway without XWayland),
        // GTK3 may fail to initialise if it defaults to X11 backend first and no
        // DISPLAY is set.  Explicitly prefer the Wayland backend when a Wayland
        // display is available.  Falls back to X11 if Wayland init fails.
        if env::var_os("WAYLAND_DISPLAY").is_some() && env::var_os("GDK_BACKEND").is_none() {
            unsafe { env::set_var("GDK_BACKEND", "wayland,x11") };
        }

        // Work around GLib version mismatch when running as an AppImage on newer
        // distros.  The AppImage bundles GLib from the CI build system (Ubuntu
        // 24.04, GLib 2.80).  Host GIO modules (e.g. GVFS's libgvfsdbus.so) may
        // link against newer GLib symbols absent in the bundled copy, producing:
        //   "undefined symbol: g_task_set_static_name"
        // Point GIO_MODULE_DIR at the AppImage's bundled modules to isolate from
        // host libraries.  Also disable the WebKit bubblewrap sandbox which fails
        // inside AppImage's FUSE mount (causes blank screen on many distros).
        if env::var_os("APPIMAGE").is_some() && env::var_os("GIO_MODULE_DIR").is_none() {
            if let Some(module_dir) = resolve_appimage_gio_module_dir() {
                unsafe { env::set_var("GIO_MODULE_DIR", &module_dir) };
            } else if env::var_os("GIO_USE_VFS").is_none() {
                // Last-resort fallback: prefer local VFS backend if module path
                // discovery fails, which reduces GVFS dependency surface.
                unsafe { env::set_var("GIO_USE_VFS", "local") };
                eprintln!(
                    "[tauri] APPIMAGE detected but bundled gio/modules not found; using GIO_USE_VFS=local fallback"
                );
            }
        }

        // WebKit2GTK's bubblewrap sandbox can fail inside an AppImage FUSE
        // mount, causing blank white screens. Disable it when running as
        // AppImage — the AppImage itself already provides isolation.
        if env::var_os("APPIMAGE").is_some() {
            // WebKitGTK 2.39.3+ deprecated WEBKIT_FORCE_SANDBOX and now expects
            // WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 instead.  Setting the
            // old variable on newer WebKitGTK triggers a noisy deprecation
            // warning in the system journal, so only set the new one.
            if env::var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_none() {
                unsafe { env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1") };
            }
            // Prevent GTK from loading host input-method modules that may
            // link against incompatible library versions.
            if env::var_os("GTK_IM_MODULE").is_none() {
                unsafe { env::set_var("GTK_IM_MODULE", "gtk-im-context-simple") };
            }

            // The linuxdeploy GStreamer hook sets GST_PLUGIN_PATH_1_0 and
            // GST_PLUGIN_SYSTEM_PATH_1_0 to only contain bundled plugins.
            // CI installs the full GStreamer codec suite (base, good, bad,
            // ugly, libav, gl) so bundleMediaFramework=true bundles everything.
            //
            // IMPORTANT: Do NOT append host plugin directories — mixing plugins
            // compiled against a different GStreamer version causes ABI mismatches
            // (undefined symbol errors like gst_util_floor_log2, mpg123_open_handle64)
            // and leaves WebKit without usable codecs.  The AppImage must be fully
            // self-contained for GStreamer.
            //
            // If the linuxdeploy hook didn't set the paths (shouldn't happen),
            // explicitly block host plugin scanning to prevent ABI conflicts.
            if env::var_os("GST_PLUGIN_SYSTEM_PATH_1_0").is_none() {
                // Empty string prevents GStreamer from scanning /usr/lib/gstreamer-1.0
                unsafe { env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", "") };
            }
        }
    }

    let builder = tauri::Builder::default();
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(LocalApiState::default())
        .manage(SecretsCache::load_from_keychain())
        .invoke_handler(tauri::generate_handler![
            list_supported_secret_keys,
            get_secret,
            get_all_secrets,
            set_secret,
            delete_secret,
            get_local_api_token,
            get_local_api_port,
            get_desktop_runtime_info,
            recognize_windows_speech,
            read_cache_entry,
            write_cache_entry,
            delete_cache_entry,
            open_logs_folder,
            open_sidecar_log_file,
            open_settings_window_command,
            close_settings_window,
            toggle_developer_tools,
            open_live_channels_window_command,
            close_live_channels_window,
            open_case_desk_window,
            close_case_desk_window,
            open_data_desk_window,
            close_data_desk_window,
            open_map_operations_window,
            close_map_operations_window,
            open_assistant_desk_window,
            close_assistant_desk_window,
            open_analysis_room_window,
            close_analysis_room_window,
            open_launch_desk_window,
            close_launch_desk_window,
            open_camera_desk_window,
            close_camera_desk_window,
            open_osint_desk_window,
            close_osint_desk_window,
            select_application_executable,
            select_launch_handoff_file,
            launch_approved_application,
            open_url,
            open_youtube_login,
            open_communications_window,
            open_communications_dock,
            update_communications_dock,
            hide_communications_dock,
            reload_communications_dock,
            close_communications_dock,
            open_source_browser_window,
            check_project_v_update,
            install_project_v_update,
            fetch_polymarket
        ])
        .setup(|app| {
            // Project V uses its own command bar. Remove the inherited native
            // File/Edit/Help menu without affecting WebView keyboard editing.
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.remove_menu();
            }

            // Load persistent cache into memory (avoids 14MB file I/O on every IPC call)
            let cache_path = cache_file_path(&app.handle()).unwrap_or_default();
            app.manage(PersistentCache::load(&cache_path));

            if let Err(err) = start_local_api(&app.handle()) {
                append_desktop_log(
                    &app.handle(),
                    "ERROR",
                    &format!("local API sidecar failed to start: {err}"),
                );
                eprintln!("[tauri] local API sidecar failed to start: {err}");
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Project V Watchtower")
        .run(|app, event| {
            match &event {
                // macOS: hide window on close instead of quitting (standard behavior)
                #[cfg(target_os = "macos")]
                RunEvent::WindowEvent {
                    label,
                    event: WindowEvent::CloseRequested { api, .. },
                    ..
                } if label == "main" => {
                    api.prevent_close();
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
                // macOS: reshow window when dock icon is clicked
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { .. } => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                // Only macOS needs explicit re-raising to keep settings above the main window.
                // On Windows, focusing the settings window here can trigger rapid focus churn
                // between windows and present as a UI hang.
                #[cfg(target_os = "macos")]
                RunEvent::WindowEvent {
                    label,
                    event: WindowEvent::Focused(true),
                    ..
                } if label == "main" => {
                    if let Some(sw) = app.get_webview_window("settings") {
                        let _ = sw.show();
                        let _ = sw.set_focus();
                    }
                }
                RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                    // Flush in-memory cache to disk before quitting
                    if let Ok(path) = cache_file_path(app) {
                        if let Some(cache) = app.try_state::<PersistentCache>() {
                            let _ = cache.flush(&path);
                        }
                    }
                    stop_local_api(app);
                }
                _ => {}
            }
        });
}
