// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Emitter;
use tauri::Manager;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn main() {
    // 不注册 tauri-plugin-single-instance：每次启动都是独立进程，
    // 靠 OS 进程隔离让各进程拥有独立的 JS 运行时与 relativePath。
    // 文件关联参数由下方 setup 里的 std::env::args() 处理。
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let file = args[1].clone();
                let handle = app.handle();
                let _ = handle.emit("open-file", file);
            }
            // if let Some(main_window) = app.get_webview_window("main") {
            //     // 获取线程安全的 AppHandle
            //     let app_handle = app.handle().clone();
            //     main_window.listen("open-about", move |_| {
            //         handle_open_about(&app_handle);
            //     });
            // } else {
            //     error!("Failed to get main window");
            // }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_md5,
            get_file_md5,
            export_pdf_with_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// fn handle_open_about(app_handle: &tauri::AppHandle) {
//     if let Some(about_window) = app_handle.get_webview_window("about") {
//         if let Err(e) = about_window.set_focus() {
//             error!("Failed to set focus to about window: {}", e);
//         }
//     } else {
//         match create_about_window(app_handle) {
//             Ok(_) => info!("About window created successfully"),
//             Err(e) => error!("Failed to create about window: {}", e),
//         }
//     }
// }

// fn create_about_window(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
//     tauri::WebviewWindowBuilder::new(app_handle, "about", WebviewUrl::App("/about".into()))
//         .title("关于")
//         .inner_size(350.0, 200.0)
//         .resizable(false) // 禁用窗口大小调整
//         .minimizable(false) // 禁用最小化按钮
//         .maximizable(false) // 禁用最大化按钮
//         .center() // 将窗口居中显示
//         .build()?;
//     Ok(())
// }

#[tauri::command]
fn get_file_md5(path: String) -> Result<String, String> {
    // 1. 打开文件
    let mut file = File::open(&path).map_err(|e| format!("无法打开文件: {}", e))?;

    // 2. 初始化 MD5 上下文
    let mut context = md5::Context::new();

    // 3. 增大缓冲区到 8KB 或更大 (通常 8*1024 或 64*1024 都不错)
    let mut buffer = [0; 8 * 1024];

    loop {
        // 阻塞读取是安全的，因为我们在普通 fn 中 (Tauri 会在独立线程运行它)
        let count = file
            .read(&mut buffer)
            .map_err(|e| format!("读取文件失败: {}", e))?;

        if count == 0 {
            break;
        }

        context.consume(&buffer[..count]);
    }

    let digest = context.finalize();
    Ok(format!("{:x}", digest))
}

#[tauri::command]
fn get_data_md5(data: Vec<u8>) -> String {
    // 对于已经在内存中的数据，直接使用 compute 即可
    // md5::compute 接收 &[u8]
    let digest = md5::compute(&data);
    format!("{:x}", digest)
}

#[tauri::command]
fn export_pdf_with_browser(
    app: tauri::AppHandle,
    html_path: String,
    output_path: String,
) -> Result<(), String> {
    if html_path.trim().is_empty() {
        return Err("HTML 临时文件路径不能为空".to_string());
    }
    if output_path.trim().is_empty() {
        return Err("PDF 输出路径不能为空".to_string());
    }

    let _html_guard = TempFileGuard::new(PathBuf::from(&html_path));
    let runtime = resolve_pdf_runtime(&app)?;
    let mut command = Command::new(&runtime.node_path);

    for arg in runtime.node_args {
        command.arg(arg);
    }

    command
        .arg(&runtime.script_path)
        .arg(&html_path)
        .arg(&output_path);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动 PDF 导出进程失败: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("退出码: {}", output.status)
        };
        return Err(format!("PDF 导出失败: {}", detail));
    }

    if !Path::new(&output_path).exists() {
        return Err("PDF 导出完成但未找到输出文件".to_string());
    }

    Ok(())
}

struct PdfRuntime {
    node_path: PathBuf,
    node_args: Vec<&'static str>,
    script_path: PathBuf,
}

struct TempFileGuard {
    path: PathBuf,
}

impl TempFileGuard {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn resolve_pdf_runtime(app: &tauri::AppHandle) -> Result<PdfRuntime, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| "无法定位项目根目录".to_string())?
        .to_path_buf();

    let mut resource_dirs = vec![manifest_dir.join("resources")];
    if let Ok(resource_dir) = app.path().resource_dir() {
        resource_dirs.push(resource_dir.clone());
        resource_dirs.push(resource_dir.join("resources"));
    }

    let node_candidates = resource_dirs
        .iter()
        .map(|dir| {
            dir.join("mermaid-cli")
                .join(if cfg!(windows) { "node.exe" } else { "node" })
        })
        .collect::<Vec<_>>();

    let script_candidates = resource_dirs
        .iter()
        .map(|dir| {
            dir.join("mermaid-cli")
                .join("app")
                .join("scripts")
                .join("pdf-export.js")
        })
        .chain([repo_root
            .join("dist-cli")
            .join("scripts")
            .join("pdf-export.js")])
        .chain([repo_root.join("scripts").join("pdf-export.ts")])
        .collect::<Vec<_>>();

    let node_path = node_candidates
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" }));

    let script_path = script_candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            "无法找到 PDF 导出脚本，请先运行 pnpm cli:build 或使用已打包版本".to_string()
        })?;

    let node_args = if script_path.extension().and_then(|ext| ext.to_str()) == Some("ts") {
        validate_node_strip_types_support(&node_path)?;
        vec!["--experimental-strip-types"]
    } else {
        Vec::new()
    };

    Ok(PdfRuntime {
        node_path,
        node_args,
        script_path,
    })
}

fn validate_node_strip_types_support(node_path: &Path) -> Result<(), String> {
    let output = Command::new(node_path)
        .arg("--version")
        .output()
        .map_err(|error| {
            format!(
                "开发环境 PDF 导出需要系统 Node.js 22.6 或更高版本以运行 TypeScript 脚本，当前无法启动 Node.js: {}",
                error
            )
        })?;

    if !output.status.success() {
        return Err(
            "开发环境 PDF 导出需要系统 Node.js 22.6 或更高版本，但 node --version 执行失败"
                .to_string(),
        );
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !is_node_version_at_least(&version, 22, 6) {
        return Err(format!(
            "开发环境 PDF 导出需要系统 Node.js 22.6 或更高版本以运行 TypeScript 脚本，当前版本为 {}。也可以先运行 pnpm cli:build 使用已编译脚本。",
            version
        ));
    }

    Ok(())
}

fn is_node_version_at_least(version: &str, required_major: u32, required_minor: u32) -> bool {
    let normalized = version.trim().trim_start_matches('v');
    let mut parts = normalized.split('.');
    let major = parts.next().and_then(|part| part.parse::<u32>().ok());
    let minor = parts.next().and_then(|part| part.parse::<u32>().ok());

    match (major, minor) {
        (Some(major), Some(minor)) if major > required_major => true,
        (Some(major), Some(minor)) if major == required_major => minor >= required_minor,
        _ => false,
    }
}
