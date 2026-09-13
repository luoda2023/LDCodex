/*
 * 只读验证：在真实 WorkBuddy 页面里核对「上弹面板新增常用语」改造所依赖的选择器与 CSS 变量。
 * 不做任何写操作：不点击、不落库、不改动既有面板；仅创建临时隐藏容器验证样式解析后立即移除。
 * 用法：node _test_daemon/cdp-qp-ui-verify.mjs [cdpPort]
 */
const PORT = process.argv[2] || '9222';

async function cdpTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await r.json();
  return list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { try { ws.close(); } catch (_) {} },
    }));
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || 'unknown'))));
    ws.addEventListener('message', (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
  });
}

async function evaluate(client, expr) {
  const r = await client.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
}

const PROBE = `(() => {
  const out = {};
  const q = (s) => document.querySelector(s);
  const btn = q('.wbs-explore-inline');
  out['面板按钮存在'] = !!btn;
  out['面板按钮 class'] = btn ? btn.className : null;
  out['已有 #wbs-explore-add（新版标志）'] = !!q('#wbs-explore-add');
  out['已有 .wbs-explore-foot（底部行）'] = !!q('.wbs-explore-foot');
  out['已有 .wbs-explore-edit（编辑 →）'] = !!q('.wbs-explore-edit');
  out['已有 .wbs-explore-send-txt（点击后发送）'] = !!q('.wbs-explore-send-txt');
  out['已有 #wbs-explore-list'] = !!q('#wbs-explore-list');
  out['已有 .wbs-explore-item（列表项）'] = !!q('.wbs-explore-item');
  out['已有 .wbs-explore-pop'] = !!q('.wbs-explore-pop');
  // 底部行是否已经是「左右两段」结构（新版才有 .wbs-explore-foot-right）
  out['已有 .wbs-explore-foot-right（新版标志）'] = !!q('.wbs-explore-foot-right');
  const item = q('.wbs-explore-item');
  out['列表项 class 样例'] = item ? item.className : null;
  // 新样式依赖的 CSS 变量是否在真实主题里可用
  const host = q('.wbs-root') || document.documentElement;
  const cs = getComputedStyle(host);
  const vars = ['--wb-border-subtle','--wb-icon-secondary','--wb-color-text-primary','--wb-bg-hover','--wb-border-default','--wb-bg-primary','--wb-bg-input','--wb-button-primary-bg','--wb-bg-popover'];
  const varState = {};
  vars.forEach((n) => { const v = cs.getPropertyValue(n).trim(); varState[n] = v || '(未定义→走 fallback)'; });
  out['CSS 变量'] = varState;
  // color-mix 支持情况（新样式大量使用）
  out['支持 color-mix()'] = (() => { try { return CSS.supports('color', 'color-mix(in srgb, #000 50%, transparent)'); } catch (_) { return false; } })();
  // 已注入的样式表里是否已包含 explore 规则（说明旧面板样式在）
  let hit = 0, editHit = 0;
  document.querySelectorAll('style').forEach((s) => {
    const t = s.textContent || '';
    if (t.indexOf('.wbs-explore-pop') >= 0) hit++;
    if (t.indexOf('wbs-explore-editing') >= 0) editHit++;
  });
  out['含 .wbs-explore-pop 的 style 数'] = hit;
  out['含 wbs-explore-editing 的 style 数（新版标志）'] = editHit;
  return JSON.stringify(out, null, 2);
})()`;

/* 在真实页面上下文里渲染一份「添加按钮 + 编辑行」，验证 CSS 解析与布局，随后立即移除。 */
const RENDER_TEST = `(() => {
  const CSS = [
    '.t12-foot{display:flex;align-items:center;justify-content:space-between;padding:10px 6px 4px;margin-top:2px;border-top:1px solid var(--wb-border-subtle,#ececec)}',
    '.t12-foot-right{display:inline-flex;align-items:center;gap:10px}',
    '.t12-add{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border:1px solid color-mix(in srgb,var(--wb-border-subtle,#ececec) 80%,transparent);border-radius:999px;background:transparent;color:var(--wb-icon-secondary,#666);font-size:12px;font-weight:500;font-family:inherit;line-height:1.4;cursor:pointer}',
    '.t12-list{width:280px}',
    '.t12-item{position:relative;display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;font-size:12px;color:var(--wb-color-text-primary,#1f1f1f);line-height:1.4;cursor:pointer}',
    '.t12-edit-row{display:block;padding:4px 2px;cursor:default}',
    '.t12-input{display:block;width:100%;box-sizing:border-box;min-height:30px;max-height:96px;resize:none;padding:6px 8px;border-radius:8px;border:1px solid var(--wb-border-default,#e5e5e5);background:var(--wb-bg-input,var(--wb-bg-primary,#fff));color:var(--wb-color-text-primary,#1f1f1f);font-size:12px;line-height:1.5;font-family:inherit;outline:none;overflow-y:auto}',
    '.t12-send{font-size:12px;color:color-mix(in srgb,var(--wb-color-text-primary) 40%,transparent)}',
  ].join('\\n');
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const box = document.createElement('div');
  box.setAttribute('data-t12-probe', '1');
  box.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
  box.innerHTML =
    '<div class="t12-list">' +
      '<div class="t12-item t12-edit-row" data-qp-new="1"><textarea class="t12-input" rows="1" placeholder="粘贴或输入常用语，Ctrl+Enter 保存"></textarea></div>' +
      '<div class="t12-item">示例常用语</div>' +
    '</div>' +
    '<div class="t12-foot">' +
      '<button type="button" class="t12-add"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg><span>添加</span></button>' +
      '<span class="t12-foot-right"><span class="t12-send">点击后发送</span><a class="t12-edit" href="#" onclick="return false">编辑 →</a></span>' +
    '</div>';
  document.body.appendChild(box);

  const g = (sel, prop) => { const el = box.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
  const rect = (sel) => { const el = box.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = {
    '按钮 display': g('.t12-add', 'display'),
    '按钮 borderRadius': g('.t12-add', 'borderRadius'),
    '按钮 fontSize': g('.t12-add', 'fontSize'),
    '按钮 borderColor（color-mix 是否解析）': g('.t12-add', 'borderColor'),
    '按钮颜色（变量是否解析）': g('.t12-add', 'color'),
    '底部行 justifyContent': g('.t12-foot', 'justifyContent'),
    '底部行 display': g('.t12-foot', 'display'),
    '编辑行 display（应为 block，非 flex）': g('.t12-edit-row', 'display'),
    '输入框 width': g('.t12-input', 'width'),
    '输入框 minHeight': g('.t12-input', 'minHeight'),
    '输入框 resize': g('.t12-input', 'resize'),
    '输入框 background': g('.t12-input', 'background-color'),
    '占位文案（placeholder）': box.querySelector('.t12-input').getAttribute('placeholder'),
    '按钮尺寸': rect('.t12-add'),
    '输入框尺寸': rect('.t12-input'),
    '底部行尺寸': rect('.t12-foot'),
    '编辑行在列表首位': box.querySelector('.t12-list').firstElementChild.classList.contains('t12-edit-row'),
    '编辑行高度 > 0（未被压塌）': rect('.t12-edit-row').h > 0,
  };
  box.remove();
  style.remove();
  return JSON.stringify(out, null, 2);
})()`;

(async () => {
  const targets = await cdpTargets();
  if (!targets.length) { console.log('未找到可用页面'); process.exit(2); }
  const t = targets.find((x) => /WorkBuddy/.test(x.title || '')) || targets[0];
  console.log('目标页面:', t.title, '\nURL:', t.url, '\n');
  const client = await connect(t.webSocketDebuggerUrl);
  try {
    const probe = await evaluate(client, PROBE);
    console.log('===== 一、真实页面现状（只读）=====');
    console.log(probe);
    console.log('\n===== 二、新样式在真实主题下的渲染结果（临时容器，已移除）=====');
    const rendered = await evaluate(client, RENDER_TEST);
    console.log(rendered);
    const leftover = await evaluate(client, "!!document.querySelector('[data-t12-probe]') || Array.from(document.querySelectorAll('style')).some(s => (s.textContent||'').indexOf('.t12-add') >= 0)");
    console.log('\n临时容器/样式残留:', leftover ? '❌ 仍存在' : '✅ 已彻底清理');
  } finally {
    client.close();
  }
})().catch((e) => { console.log('探针失败:', e.message); process.exitCode = 1; });
