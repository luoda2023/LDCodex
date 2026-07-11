//! 纯 Rust 实现的 asar 格式解包/打包（不依赖 Node.js / @electron/asar）
//!
//! asar 格式：
//!   [8字节头][JSON目录][文件内容...]
//! 头部 = 4字节 little-endian u32 (固定 0x04000000) + 4字节 little-endian u32 (JSON目录字节数)
//! JSON 目录结构：
//!   { "files": { "x.txt": { "size": N, "offset": M }, "sub": { "files": {...} } } }
//!
//! offset 是相对于 JSON 目录结束位置的字节偏移

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use anyhow::{anyhow, Context, Result};

#[derive(Debug, Clone)]
struct AsarEntry {
    size: u64,
    offset: u64, // 文件内容相对 base_offset 的偏移
}

#[derive(Debug, Clone)]
enum AsarNode {
    File(AsarEntry),
    Dir(BTreeMap<String, AsarNode>),
}

/// 读取并解析 asar 文件，返回 map（相对路径 -> (size, offset_from_base)）
pub fn read_asar(path: &Path) -> Result<(BTreeMap<String, (u64, u64)>, u64)> {
    let mut f = fs::File::open(path).with_context(|| format!("打开 asar 失败: {}", path.display()))?;
    // 读取 16 字节头（4+4+4+4：pickle 头/字符串长度/数据/尾部 padding）
    let mut header = [0u8; 16];
    f.read_exact(&mut header).context("读取 asar 头失败")?;

    // 标准 asar 头：
    //   u32 LE = 0x04000000  (4, pickle size header)
    //   u32 LE = size of JSON
    //   u32 LE = size again (redundant)
    //   u32 LE = 0  (padding)
    let json_size = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    // 有些 asar：u32 size at offset 4，padding at 8..12, JSON starts at 16
    // 标准 @electron/asar：16字节头，JSON 在 16 之后开始

    let mut json_buf = vec![0u8; json_size];
    f.read_exact(&mut json_buf).context("读取 asar 目录失败")?;
    let json_str = String::from_utf8(json_buf).context("asar JSON 解析失败")?;
    let v: serde_json::Value = serde_json::from_str(&json_str).context("asar JSON 反序列化失败")?;

    // JSON 之后是 base_offset
    let base_offset = 16u64 + json_size as u64;

    let mut entries: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    walk(&v, "", base_offset, &mut entries);
    Ok((entries, base_offset))
}

fn walk(node: &serde_json::Value, prefix: &str, base: u64, out: &mut BTreeMap<String, (u64, u64)>) {
    if let Some(files) = node.get("files").and_then(|f| f.as_object()) {
        for (name, child) in files {
            let path = if prefix.is_empty() { name.clone() } else { format!("{}\\{}", prefix, name) };
            if let Some(files_obj) = child.get("files").and_then(|f| f.as_object()) {
                if !files_obj.is_empty() {
                    walk(child, &path, base, out);
                    continue;
                }
            }
            // 文件
            let size = child.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            let offset_str = child.get("offset").and_then(|o| o.as_str()).unwrap_or("0");
            let offset = u64::from_str_radix(offset_str, 10).unwrap_or(0);
            out.insert(path, (size, base + offset));
        }
    }
}

/// 解包 asar 到指定目录
pub fn extract_asar(asar: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest).ok();
    let (entries, _base) = read_asar(asar)?;
    let mut f = fs::File::open(asar)?;
    for (rel, (size, offset)) in &entries {
        let target = dest.join(rel.replace('\\', "/"));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).ok();
        }
        f.seek(SeekFrom::Start(*offset))?;
        let mut buf = vec![0u8; *size as usize];
        if *size > 0 {
            f.read_exact(&mut buf).context(format!("读取文件内容失败: {}", rel))?;
        }
        fs::write(&target, &buf).context(format!("写入文件失败: {}", target.display()))?;
    }
    Ok(())
}

/// 打包目录到 asar 文件（标准格式，不带 integrity）
pub fn pack_asar(src: &Path, asar: &Path) -> Result<()> {
    let mut entries: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    let mut file_contents: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    collect_files(src, src, &mut entries, &mut file_contents)?;

    // 构造 JSON 目录
    let root = build_json(&entries);
    let json = serde_json::to_string(&root)?;
    let json_bytes = json.into_bytes();

    // 标准 asar 头：16 字节
    let json_size = json_bytes.len() as u32;
    let mut header = [0u8; 16];
    // @electron/asar 头：
    // 4 bytes: 0x04000000  (pickle 头，size of size field + size value)
    // 4 bytes: JSON size
    // 4 bytes: JSON size again
    // 4 bytes: 0x00000000  (padding)
    header[0..4].copy_from_slice(&0x04000000u32.to_le_bytes());
    header[4..8].copy_from_slice(&json_size.to_le_bytes());
    header[8..12].copy_from_slice(&json_size.to_le_bytes());
    header[12..16].copy_from_slice(&0u32.to_le_bytes());

    let mut out = fs::File::create(asar).context(format!("创建 asar 失败: {}", asar.display()))?;
    out.write_all(&header)?;
    out.write_all(&json_bytes)?;

    // base_offset
    let base_offset = 16u64 + json_size as u64;

    // 按收集顺序写入文件
    let mut sorted: Vec<_> = entries.iter().collect();
    sorted.sort_by_key(|(_, (_, off))| *off);

    let mut current_offset = base_offset;
    for (rel, (size, offset)) in &sorted {
        // 找到对应的文件内容
        let idx = file_contents.iter().position(|(p, _)| {
            let r = p.strip_prefix(src).unwrap_or(p).to_string_lossy().replace('/', "\\");
            r == **rel
        }).unwrap_or(0);
        let content = &file_contents[idx].1;
        debug_assert_eq!(*offset, current_offset, "offset 不匹配: {}", rel);
        out.write_all(content)?;
        current_offset += *size;
    }

    Ok(())
}

fn collect_files(
    base: &Path,
    cur: &Path,
    entries: &mut BTreeMap<String, (u64, u64)>,
    file_contents: &mut Vec<(PathBuf, Vec<u8>)>,
) -> Result<()> {
    let mut offset: u64 = 0;
    collect_recursive(base, cur, "", entries, file_contents, &mut offset)
}

fn collect_recursive(
    base: &Path,
    cur: &Path,
    prefix: &str,
    entries: &mut BTreeMap<String, (u64, u64)>,
    file_contents: &mut Vec<(PathBuf, Vec<u8>)>,
    offset: &mut u64,
) -> Result<()> {
    for entry in cur.read_dir().context(format!("读取目录失败: {}", cur.display()))? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() { name.clone() } else { format!("{}\\{}", prefix, name) };

        if path.is_dir() {
            collect_recursive(base, &path, &rel, entries, file_contents, offset)?;
        } else {
            let content = fs::read(&path)?;
            let size = content.len() as u64;
            entries.insert(rel.clone(), (size, *offset));
            file_contents.push((path, content));
            *offset += size;
        }
    }
    Ok(())
}

fn build_json(entries: &BTreeMap<String, (u64, u64)>) -> serde_json::Value {
    let mut root = serde_json::json!({"files": {}});
    for (rel, (size, offset)) in entries {
        let parts: Vec<&str> = rel.split('\\').collect();
        insert_into(&mut root, &parts, *size, *offset);
    }
    root
}

fn insert_into(node: &mut serde_json::Value, parts: &[&str], size: u64, offset: u64) {
    if parts.is_empty() { return; }
    let files = node.get_mut("files").unwrap().as_object_mut().unwrap();
    if parts.len() == 1 {
        files.insert(
            parts[0].to_string(),
            serde_json::json!({
                "size": size,
                "offset": offset.to_string()
            }),
        );
    } else {
        if !files.contains_key(parts[0]) {
            files.insert(parts[0].to_string(), serde_json::json!({"files": {}}));
        }
        insert_into(files.get_mut(parts[0]).unwrap(), &parts[1..], size, offset);
    }
}

/// 注入插件到 ZCode app.asar：
/// 1. 解包
/// 2. 复制 zcode-customize.js 到 out/renderer/assets/
/// 3. 修改 out/renderer/index.html，在 </body> 前插入 <script> 引用
/// 4. 重新打包
pub fn inject_zcode_plugin_asar(asar: &Path, plugin_js: &Path) -> Result<()> {
    let tmp_dir = std::env::temp_dir().join("ldcodex-asar-inject");
    let _ = fs::remove_dir_all(&tmp_dir);
    fs::create_dir_all(&tmp_dir)?;

    // 1. 解包
    extract_asar(asar, &tmp_dir).context("解包 asar 失败")?;

    // 2. 复制插件脚本
    let assets_dir = tmp_dir.join("out").join("renderer").join("assets");
    fs::create_dir_all(&assets_dir).ok();
    fs::copy(plugin_js, assets_dir.join("zcode-customize.js"))
        .context(format!("复制插件失败: {}", plugin_js.display()))?;

    // 3. 修改 index.html
    let index_html = tmp_dir.join("out").join("renderer").join("index.html");
    if !index_html.exists() {
        return Err(anyhow!("找不到 index.html: {}", index_html.display()));
    }
    let html = fs::read_to_string(&index_html)?;
    let marker = "<script defer src=\"./assets/zcode-customize.js\"></script>";
    let new_html = if html.contains(marker) {
        html
    } else {
        html.replace("</body>", &format!("    {}\n</body>", marker))
    };
    fs::write(&index_html, new_html)?;

    // 4. 重新打包
    pack_asar(&tmp_dir, asar).context("重新打包 asar 失败")?;

    let _ = fs::remove_dir_all(&tmp_dir);
    Ok(())
}
