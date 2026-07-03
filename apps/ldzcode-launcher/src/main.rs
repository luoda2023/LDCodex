#![cfg_attr(windows, windows_subsystem = "windows")]

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let options = parse_launch_options(args);

    // 自动检测 ZCode.exe 路径
    let zcode_exe = find_zcode_exe()?;

    // 检查是否已有实例运行
    if is_process_running("ZCode.exe") {
        eprintln!("ZCode 已在运行中，激活现有窗口。");
        return Ok(());
    }

    // 启动 ZCode
    launch_zcode(&zcode_exe, &options)?;

    Ok(())
}

fn find_zcode_exe() -> Result<PathBuf> {
    // 1. 标准安装路径
    let exe = PathBuf::from(
        r"C:\Users\Administrator\AppData\Local\Programs\ZCode\ZCode.exe",
    );
    if exe.exists() {
        return Ok(exe);
    }

    // 2. 本地应用数据路径 (更通用的检测)
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let exe2 = PathBuf::from(&local_app_data)
            .join("Programs")
            .join("ZCode")
            .join("ZCode.exe");
        if exe2.exists() {
            return Ok(exe2);
        }
    }

    // 3. 环境变量 ZCODE_PATH
    if let Ok(path) = std::env::var("ZCODE_PATH") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return Ok(p);
        }
    }

    // 4. PATH 查找
    if let Ok(found) = which_in_path("ZCode.exe") {
        return Ok(found);
    }

    anyhow::bail!(
        "未找到 ZCode 安装。请确认已安装 ZCode（默认路径: %LOCALAPPDATA%\\Programs\\ZCode\\ZCode.exe）。"
    )
}

fn which_in_path(name: &str) -> Result<PathBuf> {
    let output = if cfg!(windows) {
        std::process::Command::new("where")
            .arg(name)
            .output()
    } else {
        std::process::Command::new("which")
            .arg(name)
            .output()
    }
    .context("搜索 PATH 失败")?;

    if !output.status.success() {
        anyhow::bail!("未在 PATH 中找到 {}", name);
    }

    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    if line.is_empty() {
        anyhow::bail!("PATH 查询结果为空");
    }

    let p = PathBuf::from(&line);
    if p.exists() { Ok(p) } else { anyhow::bail!("PATH 找到的文件不存在: {}", line) }
}

/// 检查指定名称的进程是否在运行（跨平台简单检测）
fn is_process_running(name: &str) -> bool {
    let output = if cfg!(windows) {
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {}", name), "/NH"])
            .output()
    } else {
        std::process::Command::new("pgrep")
            .arg(name)
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if cfg!(windows) {
                stdout.contains(name)
            } else {
                out.status.success()
            }
        }
        Err(_) => false,
    }
}

fn launch_zcode(exe: &Path, _options: &LaunchOptions) -> Result<()> {
    let mut cmd = std::process::Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .with_context(|| format!("启动 ZCode 失败: {}", exe.display()))?;
    eprintln!("ZCode 已启动: {}", exe.display());
    Ok(())
}

#[derive(Default)]
struct LaunchOptions {
    #[allow(dead_code)]
    app_dir: Option<PathBuf>,
}

fn parse_launch_options<I, S>(args: I) -> LaunchOptions
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut options = LaunchOptions::default();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_ref() {
            "--app-path" => {
                if let Some(value) = iter.next() {
                    let value = value.as_ref().trim();
                    if !value.is_empty() {
                        options.app_dir = Some(PathBuf::from(value));
                    }
                }
            }
            _ => {}
        }
    }
    options
}
