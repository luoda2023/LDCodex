pub fn proxied_client(user_agent: &str) -> anyhow::Result<reqwest::Client> {
    let ua = if user_agent.trim().is_empty() {
        format!("LDCodex/{}", env!("CARGO_PKG_VERSION"))
    } else {
        user_agent.trim().to_string()
    };
    // 必须显式 no_proxy()：reqwest 默认会读取操作系统代理（Windows 的 WinINET/注册表、
    // 以及 HTTP(S)_PROXY 环境变量）。协议代理是本地中转服务，上游地址由用户显式填写，
    // 一旦继承系统代理，用户本机的科学上网工具未运行时（端口 SYN_SENT 卡死）会让
    // 所有上游请求都以「上游请求失败」告终，表现为 Codex 端 error sending request。
    Ok(reqwest::Client::builder().user_agent(ua).no_proxy().build()?)
}

/// VLM 专用 HTTP client（带超时）。
/// 不复用通用 proxied_client，避免 VLM 服务无响应时永久阻塞整个代理。
pub fn vlm_http_client() -> anyhow::Result<reqwest::Client> {
    vlm_http_client_with_timeout(
        std::time::Duration::from_secs(5),
        std::time::Duration::from_secs(30),
    )
}

pub(crate) fn vlm_http_client_with_timeout(
    connect: std::time::Duration,
    total: std::time::Duration,
) -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(format!("LDCodex-VLM/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(connect)
        .timeout(total)
        .build()?)
}
