use std::sync::LazyLock;
use std::time::Duration;

/// 全局复用 HTTP client，支持 HTTP/2 和连接池
static PROXY_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    let ua = format!("CodexAssist/{}", env!("CARGO_PKG_VERSION"));
    reqwest::Client::builder()
        .user_agent(ua)
        // 连接池：每个 host 最多保持 4 个空闲连接
        .pool_max_idle_per_host(4)
        // TCP keepalive 间隔
        .tcp_keepalive(Some(Duration::from_secs(30)))
        // 连接超时 10 秒
        .connect_timeout(Duration::from_secs(10))
        // 总超时 5 分钟（防止挂死）
        .timeout(Duration::from_secs(300))
        .build()
        .expect("Failed to build global HTTP client")
});

/// 创建代理 HTTP 客户端（返回全局复用实例）
pub fn proxied_client(_user_agent: &str) -> anyhow::Result<reqwest::Client> {
    Ok(PROXY_CLIENT.clone())
}