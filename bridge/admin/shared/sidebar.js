/* ══════════════════════════════════════════════════════════════
 * LUODA中转路由 · 统一侧边栏
 * 所有页面共用，避免重复维护
 * ══════════════════════════════════════════════════════════════ */

window.LUODA_SIDEBAR = {
  // 侧边栏导航定义
  nav: [
    {
      section: '概览',
      items: [
        { href: 'index.html', icon: 'fa-solid fa-gauge-high', label: '控制台', id: 'index' },
        { href: 'models.html', icon: 'fa-solid fa-cube', label: 'AI 模型库', badge: true, id: 'models' },
        { href: 'models.html#builtins', icon: 'fa-solid fa-layer-group', label: '内置模型库', sub: true, id: 'models-builtins' },
        { href: 'models.html#abnormal', icon: 'fa-solid fa-triangle-exclamation', label: '异常模型', sub: true, id: 'models-abnormal' },
        { href: 'vision-models.html', icon: 'fa-regular fa-eye', label: '视觉模型', sub: true, id: 'vision-models' },
      ]
    },
    {
      section: '转发代理',
      items: [
        { href: 'openrelay.html', icon: 'fa-solid fa-arrows-spin', label: 'AI 配额管理', id: 'openrelay' },
        { href: 'settings-port.html', icon: 'fa-solid fa-pen', label: '端口修改', sub: true, id: 'settings-port' },
        { href: 'settings-restart.html', icon: 'fa-solid fa-rotate', label: '重启服务', sub: true, id: 'settings-restart' },
        { href: 'settings-logs.html', icon: 'fa-solid fa-file-lines', label: '查看日志', sub: true, id: 'settings-logs' },
      ]
    },
    {
      section: null,
      items: [
        { href: 'settings-system.html', icon: 'fa-solid fa-gear', label: '系统设置', id: 'settings-system' },
        { href: 'about.html', icon: 'fa-solid fa-circle-info', label: '关于', id: 'about' },
      ]
    }
  ],

  // 注入侧边栏到当前页面
  inject: function(currentPageId) {
    var root = document.getElementById('sidebarRoot');
    if (!root) return;

    var html = '';
    html += '<aside class="sidebar">';
    html += '  <div class="sidebar-logo">';
    html += '    <div class="logo-mrk">L</div>';
    html += '    <span class="logo-nm">LUODA中转路由</span>';
    html += '    <span class="logo-bd">v3</span>';
    html += '  </div>';
    html += '  <nav class="sidebar-nav">';

    var self = this;
    this.nav.forEach(function(sec) {
      html += '<div class="nav-sec">';
      if (sec.section) {
        html += '<div class="nav-sec-title">' + sec.section + '</div>';
      }
      sec.items.forEach(function(item) {
        var active = item.id === currentPageId ? ' active' : '';
        var subClass = item.sub ? ' nav-sub' : '';
        var badgeCount = '0';
        var badgeHtml = '';
        if (item.badge) {
          try {
            var snap = localStorage.getItem('luoda-models-snapshot');
            if (snap) {
              var arr = JSON.parse(snap);
              if (arr && arr.length) badgeCount = String(arr.length);
            }
          } catch(e) {}
          badgeHtml = '<span class="nav-badge" id="sidebarTotalBadge">' + badgeCount + '</span>';
        }
        html += '<a class="nav-item' + active + subClass + '" href="' + item.href + '">';
        html += '<i class="' + item.icon + '"></i> ' + item.label + badgeHtml;
        html += '</a>';
      });
      html += '</div>';
    });

    html += '  </nav>';
    html += '  <div class="sidebar-cta">';
    html += '    <div class="cta-icon">&#9889;</div>';
    html += '    <div class="cta-title">全自动轮循作业</div>';
    html += '    <div class="cta-desc">智能切换 · 异常隔离 · 零人工介入</div>';
    html += '    <button class="cta-btn" onclick="location.href=\'models.html\'">+ 新建模型</button>';
    html += '  </div>';
    html += '  <div class="sidebar-footer" style="padding:6px 8px;border-top:1px solid var(--border);flex-shrink:0;">';
    html += '    <a class="nav-item" href="javascript:LUODA_AUTH.logout()" style="color:var(--danger);">';
    html += '      <i class="fa-solid fa-right-from-bracket" style="color:var(--danger);"></i> 退出登录';
    html += '    </a>';
    html += '  </div>';
    html += '</aside>';

    root.outerHTML = html;

    // 同步模型数量到侧栏 badge（所有页面通用）
    if (typeof LUODA_STATE !== 'undefined' && LUODA_STATE.syncModelsSnapshot) {
      LUODA_STATE.syncModelsSnapshot();
    }
  }
};
