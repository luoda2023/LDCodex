//! LDCodex 构建脚本：给静默启动器 `ldcodex` 嵌入图标、应用程序清单与版本信息。
//!
//! 为什么不再用 `winresource`：该 crate 的构造函数会**无条件**调用 `reg.exe`
//! 去注册表查询 Windows SDK 路径。在 `reg.exe` 被安全策略拉黑的环境里
//! （企业终端管控、WorkBuddy 命令安全中心等），整个构建会被直接终止，
//! 而这一步本来就是 `rc.exe` 的一个开关能解决的事。
//!
//! LDCodex 因此自行定位 `rc.exe` 并只驱动它一次：不读注册表、不探测外部进程，
//! 也顺带把版本信息字段收归自有（公司名指向 dicad.cn）。

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../codex-plus-manager/src-tauri/icons/launcher.ico");
    println!("cargo:rerun-if-changed=../codex-plus-manager/src-tauri/windows-app-manifest.xml");
    println!("cargo:rerun-if-env-changed=RC_PATH");

    #[cfg(windows)]
    windows::embed();
}

#[cfg(windows)]
mod windows {
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// 打包进 `ldcodex.exe` 的目标文件名，`rustc-link-arg-bin` 需要它精确匹配。
    const BINARY_NAME: &str = "ldcodex";

    pub fn embed() {
        let manifest_dir =
            PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("缺少 CARGO_MANIFEST_DIR"));
        let icon = absolute(
            &manifest_dir.join("../codex-plus-manager/src-tauri/icons/launcher.ico"),
        );
        let manifest = absolute(
            &manifest_dir.join("../codex-plus-manager/src-tauri/windows-app-manifest.xml"),
        );

        for asset in [&icon, &manifest] {
            assert!(asset.is_file(), "缺少构建资源：{}", asset.display());
        }

        let out_dir = PathBuf::from(env::var("OUT_DIR").expect("缺少 OUT_DIR"));
        let script = out_dir.join("ldcodex-resource.rc");
        let resource = out_dir.join("ldcodex-resource.res");
        fs::write(&script, resource_script(&icon, &manifest)).expect("写入资源脚本失败");

        let rc_exe = find_rc_exe().unwrap_or_else(|| {
            panic!(
                "未找到 rc.exe，无法嵌入图标与清单。\n\
                 请安装 Windows SDK，或用环境变量 RC_PATH 显式指定，例如：\n\
                 RC_PATH=C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\rc.exe"
            )
        });

        let output = Command::new(&rc_exe)
            .arg("/nologo")
            .arg("/fo")
            .arg(&resource)
            .arg(&script)
            .output()
            .unwrap_or_else(|err| panic!("无法执行 {}：{err}", rc_exe.display()));

        if !output.status.success() {
            panic!(
                "rc.exe 编译资源失败（{}）：\n{}{}",
                rc_exe.display(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }

        // 只作用于 ldcodex 这一个二进制目标，不波及同 crate 的其他产物。
        println!("cargo:rustc-link-arg-bin={BINARY_NAME}={}", resource.display());
    }

    /// 定位 Windows SDK 自带的资源编译器。
    ///
    /// 优先采用 `RC_PATH` 显式指定，其次 `WindowsSdkVerBinPath`（VS 开发者命令行
    /// 会给出），最后扫描各候选 `Windows Kits\10\bin\<版本>\x64\` 取版本最高者。
    /// 全程只读文件系统，不触碰注册表。
    fn find_rc_exe() -> Option<PathBuf> {
        if let Some(explicit) = env::var_os("RC_PATH") {
            let candidate = PathBuf::from(explicit);
            if candidate.is_file() {
                return Some(candidate);
            }
            println!(
                "cargo:warning=RC_PATH 指向的文件不存在，回退到自动探测：{}",
                candidate.display()
            );
        }

        if let Some(dir) = env::var_os("WindowsSdkVerBinPath") {
            let candidate = PathBuf::from(dir).join("x64").join("rc.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        let mut found: Option<(Vec<u32>, PathBuf)> = None;
        for root in sdk_bin_roots() {
            let Ok(entries) = fs::read_dir(&root) else {
                continue;
            };
            for entry in entries.flatten() {
                let rc = entry.path().join("x64").join("rc.exe");
                if !rc.is_file() {
                    continue;
                }
                let version = parse_version(&entry.file_name().to_string_lossy());
                if found.as_ref().map_or(true, |(best, _)| version > *best) {
                    found = Some((version, rc));
                }
            }
        }
        found.map(|(_, rc)| rc)
    }

    /// 枚举所有可能的 `Windows Kits\10\bin` 目录。
    ///
    /// 刻意不把 `ProgramFiles(x86)` 当作唯一依据：受管控终端与沙箱构建环境
    /// 可能根本不导出该变量，因此再补上由系统盘推导出的常规安装位置。
    fn sdk_bin_roots() -> Vec<PathBuf> {
        fn push(roots: &mut Vec<PathBuf>, root: PathBuf) {
            if !roots.contains(&root) {
                roots.push(root);
            }
        }

        let mut roots = Vec::new();
        for key in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
            if let Some(base) = env::var_os(key) {
                push(
                    &mut roots,
                    PathBuf::from(base).join("Windows Kits").join("10").join("bin"),
                );
            }
        }

        let drive = env::var_os("SystemDrive").unwrap_or_else(|| {
            env::var_os("SystemRoot")
                .and_then(|root| PathBuf::from(root).parent().map(Path::to_path_buf))
                .unwrap_or_else(|| PathBuf::from("C:\\"))
                .into_os_string()
        });

        for program_files in ["Program Files (x86)", "Program Files"] {
            push(
                &mut roots,
                PathBuf::from(&drive)
                    .join(program_files)
                    .join("Windows Kits")
                    .join("10")
                    .join("bin"),
            );
        }

        roots
    }

    /// 把 `10.0.26100.0` 这类目录名解析成可比较的数字串；解析不出即截断。
    fn parse_version(name: &str) -> Vec<u32> {
        name.split('.')
            .map_while(|part| part.parse::<u32>().ok())
            .collect()
    }

    /// 组装 .rc 脚本：图标、清单（RT_MANIFEST，资源 id 1）与版本信息。
    fn resource_script(icon: &Path, manifest: &Path) -> String {
        let version = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into());
        let [major, minor, patch, build] = version_quad(&version);
        let icon = rc_literal(icon);
        let manifest = rc_literal(manifest);

        format!(
            r#"1 ICON "{icon}"
1 24 "{manifest}"

1 VERSIONINFO
FILEVERSION {major},{minor},{patch},{build}
PRODUCTVERSION {major},{minor},{patch},{build}
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "CompanyName", "dicad.cn"
      VALUE "FileDescription", "LDCodex Launcher"
      VALUE "FileVersion", "{version}"
      VALUE "InternalName", "ldcodex"
      VALUE "OriginalFilename", "ldcodex.exe"
      VALUE "ProductName", "LDCodex"
      VALUE "ProductVersion", "{version}"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
"#
        )
    }

    /// `1.2.56` → `[1, 2, 56, 0]`，供 VERSIONINFO 的四段数字字段使用。
    fn version_quad(version: &str) -> [u32; 4] {
        let mut quad = [0u32; 4];
        for (slot, part) in quad.iter_mut().zip(version.split(['.', '-'])) {
            *slot = part.trim().parse().unwrap_or(0);
        }
        quad
    }

    /// 归一化成绝对路径：展开 `..`，且不引入 `\\?\` 前缀（rc.exe 不认该前缀）。
    fn absolute(path: &Path) -> PathBuf {
        std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
    }

    /// .rc 中的字符串按 C 语义转义，反斜杠必须写成两个。
    fn rc_literal(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "\\\\")
    }
}
