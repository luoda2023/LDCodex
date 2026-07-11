//! 纯 Rust 实现的 asar 格式解包/打包（完全兼容 @electron/asar 4.x）
//!
//! pickle 格式（@electron/asar v4）：
//!   [size_pickle: 8字节][header_pickle: 可变][文件内容...]
//!
//! size_pickle:
//!   [0..4] u32 LE: payload_size = 4（仅有1个u32值）
//!   [4..8] u32 LE: header_pickle 的总字节数
//!
//! header_pickle:
//!   [0..4] u32 LE: payload_size = header_pickle不含前4字节的大小
//!   [4..8] u32 LE: JSON 字符串的字节长度
//!   [8..]  原始 JSON 字符串, 对齐到 4 字节末尾补0
//!
//! JSON 目录格式:
//!   {"files": {"x.txt": {"size": N, "offset": "M"}, "dir": {"files": {...}}}}
//!   offset 是相对 base_offset（size_pickle + header_pickle 总大小）的相对偏移

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use anyhow::{anyhow, Context, Result};

/// 读取 asar 文件，解析出 JSON 目录字符串和文件基偏移
fn read_asar_header(path: &Path) -> Result<(String, u64)> {
    let mut f = fs::File::open(path)?;

    // 1. 读 size_pickle (8字节)
    let mut size_buf = [0u8; 8];
    f.read_exact(&mut size_buf)?;
    let _payload_size = u32::from_le_bytes([size_buf[0], size_buf[1], size_buf[2], size_buf[3]]);
    let header_size = u32::from_le_bytes([size_buf[4], size_buf[5], size_buf[6], size_buf[7]]) as usize;

    // 2. 读 header_pickle
    let mut header_buf = vec![0u8; header_size];
    f.read_exact(&mut header_buf)?;

    // 3. 解析 header_pickle
    // [0..4] payload_size（含前4字节）
    // [4..8] 字符串长度
    // [8..]  字符串数据
    if header_buf.len() < 8 {
        return Err(anyhow!("header_pickle 过短"));
    }
    let _hp_payload = u32::from_le_bytes([
        header_buf[0], header_buf[1], header_buf[2], header_buf[3]
    ]);
    let str_len = u32::from_le_bytes([
        header_buf[4], header_buf[5], header_buf[6], header_buf[7]
    ]) as usize;

    if 8 + str_len > header_buf.len() {
        return Err(anyhow!("JSON 字符串长度超过 header_pickle"));
    }

    let json_bytes = &header_buf[8..8 + str_len];
    let json_str = String::from_utf8(json_bytes.to_vec())
        .map_err(|e| anyhow!("JSON 编码错误: {}", e))?;

    let base_offset: u64 = 8 + header_size as u64;
    Ok((json_str, base_offset))
}

/// 解析 JSON 目录，收集文件信息（相对路径 -> (size, abs_offset)）
fn walk_json(node: &serde_json::Value, prefix: &str, base: u64, out: &mut BTreeMap<String, (u64, u64)>) {
    let files = match node.get("files").and_then(|f| f.as_object()) {
        Some(f) => f,
        None => return,
    };
    for (name, child) in files {
        let rel = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };

        if child.get("files").and_then(|f| f.as_object()).map(|o| !o.is_empty()).unwrap_or(false) {
            walk_json(child, &rel, base, out);
        } else {
            let size = child.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            let offset_str = child.get("offset").and_then(|o| o.as_str()).unwrap_or("0");
            let rel_offset = u64::from_str_radix(offset_str, 10).unwrap_or(0);
            out.insert(rel, (size, base + rel_offset));
        }
    }
}

/// 解包 asar 到指定目录
pub fn extract_asar(asar: &Path, dest: &Path) -> Result<()> {
    let (json_str, base_offset) = read_asar_header(asar)?;
    let v: serde_json::Value = serde_json::from_str(&json_str)?;

    let mut file_info: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    walk_json(&v, "", base_offset, &mut file_info);

    let mut f = fs::File::open(asar)?;
    fs::create_dir_all(dest)?;

    for (rel, (size, abs_offset)) in &file_info {
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut content = vec![0u8; *size as usize];
        f.seek(SeekFrom::Start(*abs_offset))?;
        if *size > 0 {
            f.read_exact(&mut content)?;
        }
        fs::write(&target, &content).context(format!("写入失败: {}", target.display()))?;
    }
    Ok(())
}

/// 打包目录到 asar 文件（完全兼容 @electron/asar 4.x pickle 格式）
pub fn pack_asar(src: &Path, asar: &Path) -> Result<()> {
    let mut entries: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    collect_files(src, "", &mut entries)?;

    // 计算相对偏移
    let mut offset: u64 = 0;
    let mut json_entries: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    for (rel, content) in &entries {
        json_entries.insert(rel.clone(), (content.len() as u64, offset));
        offset += content.len() as u64;
    }

    // 构造 JSON
    let root = build_json(&json_entries);
    let json = serde_json::to_string(&root)?;
    let json_bytes = json.into_bytes();
    let json_len = json_bytes.len() as u32;
    let aligned_json_len = ((json_len + 3) / 4) * 4;

    // ==== header_pickle ====
    // [payload_size(4)][string_length(4)][string_data(对齐到4)]
    let hp_payload_size = 4 + aligned_json_len; // string_length + string_data
    let header_pickle_size = 4 + hp_payload_size; // payload_size 自身 + 内容
    let mut hp = vec![0u8; header_pickle_size as usize];
    hp[0..4].copy_from_slice(&hp_payload_size.to_le_bytes());
    hp[4..8].copy_from_slice(&json_len.to_le_bytes());
    hp[8..8 + json_len as usize].copy_from_slice(&json_bytes);
    // 对齐填充（hp 已初始化为 0，尾部自动补 0）

    // ==== size_pickle ====
    // [size_payload_size=4(4)][header_pickle总大小(4)]
    // size_pickle 的 payload_size = 4（只有 1 个 u32）
    // 写入时整体为 8 字节
    let mut sp = vec![0u8; 8];
    sp[0..4].copy_from_slice(&4u32.to_le_bytes());
    sp[4..8].copy_from_slice(&header_pickle_size.to_le_bytes());

    // ==== 写入文件 ====
    let mut out = fs::File::create(asar).context(format!("创建 asar 失败: {}", asar.display()))?;
    out.write_all(&sp)?;
    out.write_all(&hp)?;

    for (rel, content) in &entries {
        let _ = rel;
        out.write_all(content)?;
    }

    Ok(())
}

fn collect_files(base: &Path, prefix: &str, entries: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
    if !base.is_dir() {
        return Ok(());
    }
    let mut items: Vec<_> = fs::read_dir(base)?
        .collect::<std::io::Result<Vec<_>>>()?;
    items.sort_by_key(|e| e.file_name());

    for entry in items {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };

        if path.is_dir() {
            collect_files(&path, &rel, entries)?;
        } else {
            entries.insert(rel, fs::read(&path)?);
        }
    }
    Ok(())
}

fn build_json(entries: &BTreeMap<String, (u64, u64)>) -> serde_json::Value {
    let mut root = serde_json::json!({"files": {}});
    for (rel, (size, offset)) in entries {
        let parts: Vec<&str> = rel.split('/').collect();
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

/// 注入插件到 ZCode app.asar
pub fn inject_zcode_plugin_asar(asar: &Path, plugin_js: &Path) -> Result<()> {
    let tmp_dir = std::env::temp_dir().join("ldcodex-asar-inject");
    let _ = fs::remove_dir_all(&tmp_dir);
    fs::create_dir_all(&tmp_dir)?;

    extract_asar(asar, &tmp_dir).context("解包 asar 失败")?;

    // 复制插件脚本
    let assets_dir = tmp_dir.join("out").join("renderer").join("assets");
    fs::create_dir_all(&assets_dir).ok();
    fs::copy(plugin_js, assets_dir.join("zcode-customize.js"))
        .context(format!("复制插件失败: {}", plugin_js.display()))?;

    // 修改 index.html
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

    pack_asar(&tmp_dir, asar).context("重新打包 asar 失败")?;

    let _ = fs::remove_dir_all(&tmp_dir);
    Ok(())
}
