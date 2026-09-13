'use strict';
/*
 * 验证「弹窗自动点允许」的判定逻辑（inject.js），重点是 1.2.9 修的误杀缺陷。
 *
 * 缺陷背景（实机复现）：
 *   ndApprovalContext() 的扣费防护会从按钮向上最多 8 层探测「积分/付费」类文案，
 *   而探测范围包含 document.body。WorkBuddy 首页常驻「邀请好友可获得 100 积分」横幅，
 *   于是整页文本必然命中 ND_CREDIT_PATTERN，任何确认弹窗都被判成扣费弹窗而永不点击。
 *   实测：同一个合成弹窗，页面含积分文案时分类结果为 null，去掉积分文案后为 once。
 *
 * 修复：
 *   - 页面根（body/html）不参与扣费判定，也不作为决策容器；
 *   - 文本过长的页面级包裹层同样排除（真正的扣费弹窗文案是紧凑的）。
 *
 * 做法：从 inject.js 提取真实函数源码，注入一个最小 DOM 桩执行。
 */
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME = 'D:/LUODA/LDcodex/apps/codex-plus-manager/src-tauri/workbuddy-runtime';
const src = fs.readFileSync(path.join(RUNTIME, 'inject.js'), 'utf8');

function extractFn(source, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(source);
  if (!m) return null;
  let i = source.indexOf('{', m.index);
  if (i < 0) return null;
  const start = m.index;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + '  ::  ' + (detail || ''));
}

// —— 提取 inject.js 真实函数（含常量） ——
const NEEDED = ['classifyNoDisturbApprovalCandidate', 'ndNormalizeLabel', 'ndIsDecisionGroup',
  'ndIsPageRoot', 'ndCreditText', 'ndClassifyApprovalCandidate', 'ndApprovalContext'];
const parts = NEEDED.map((n) => extractFn(src, n));
const missing = NEEDED.filter((n, i) => !parts[i]);
rec('提取 inject.js 判定函数', missing.length === 0,
  missing.length ? ('缺失: ' + missing.join(', ')) : NEEDED.join(' / '));

// 正则常量直接抄自 inject.js（提取正则字面量易碎，这里显式对齐）
const ND_CONSTANTS = `
var ND_CREDIT_PATTERN = /积分|信用|credit|消耗|付费|支付|费用|金额|余额|扣费/i;
var ND_DENY_WORD = /拒绝|Deny/i;
var ND_ONCE_LABEL = /^(允许|允许一次|Allow|Yes|同意|批准|确认允许)$/i;
var ND_CONFIRM_PATTERN = /批量删除|沙箱|越界|越权|系统级工具|系统工具|权限|允许访问|将运行|需要你确认|需要你的确认|确认允许|检测到|受保护|敏感|凭据|黑名单|sandbox|approval|permission/i;
var ND_CREDIT_SCOPE_MAX = 1200;
`;

// —— 最小 DOM 桩 ——
function makeEl(tag, ownText) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _text: ownText || '',
    children: [],
    parentElement: null,
    disabled: false,
    _attrs: {},
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      let s = el._text;
      for (const c of el.children) s += c.textContent;
      return s;
    },
  });
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.appendChild = (c) => { c.parentElement = el; el.children.push(c); return c; };
  el.querySelectorAll = (sel) => {
    const out = [];
    const want = String(sel || '').trim().toLowerCase();
    (function walk(n) {
      for (const c of n.children) {
        if (want === 'button' && c.tagName === 'BUTTON') out.push(c);
        walk(c);
      }
    })(el);
    return out;
  };
  return el;
}

const body = makeEl('body');
const html = makeEl('html');
body.parentElement = html;
global.document = { body, documentElement: html };

const sandbox = {};
const code = ND_CONSTANTS + '\n' + parts.filter(Boolean).join('\n\n') +
  '\nreturn { classifyNoDisturbApprovalCandidate, ndNormalizeLabel, ndIsDecisionGroup, ndIsPageRoot, ndCreditText, ndClassifyApprovalCandidate, ndApprovalContext };';
let api = null;
try {
  api = new Function(code)();
} catch (e) {
  rec('编译提取出的函数', false, e.message);
}

if (api) {
  // 1) 页面根不参与扣费判定
  rec('ndIsPageRoot(body/html) 为真', api.ndIsPageRoot(body) === true && api.ndIsPageRoot(html) === true,
    'body=' + api.ndIsPageRoot(body) + ' html=' + api.ndIsPageRoot(html));
  const div = makeEl('div', '普通容器');
  rec('ndIsPageRoot(div) 为假', api.ndIsPageRoot(div) === false, String(api.ndIsPageRoot(div)));

  // 2) 扣费取样范围：body / 超长容器一律返回空
  rec('ndCreditText(body) 为空（页面根不取样）', api.ndCreditText(body) === '', JSON.stringify(api.ndCreditText(body)));
  const huge = makeEl('div', '积分'.repeat(700));
  rec('ndCreditText(超长容器) 为空', api.ndCreditText(huge) === '', 'len=' + huge.textContent.length);
  const compact = makeEl('div', '本次生成将消耗 30 积分');
  rec('ndCreditText(紧凑容器) 原样返回', api.ndCreditText(compact).indexOf('积分') >= 0, api.ndCreditText(compact));

  // 3) 纯分类器：通用「确认」绝不能过；扣费文案必须挡
  rec('分类器：含积分的上下文一律拒绝',
    api.classifyNoDisturbApprovalCandidate({ label: '允许', context: '本次生成将消耗 30 积分，是否确认？', hasDeny: true, hasOnce: true, buttonCount: 2 }) === null,
    'null 期望');
  rec('分类器：「允许」+权限语境 => once',
    api.classifyNoDisturbApprovalCandidate({ label: '允许', context: '需要你确认：是否允许访问系统权限', hasDeny: true, hasOnce: true, buttonCount: 2 }) === 'once',
    String(api.classifyNoDisturbApprovalCandidate({ label: '允许', context: '需要你确认：是否允许访问系统权限', hasDeny: true, hasOnce: true, buttonCount: 2 })));
  rec('分类器：带序号的「1允许」规范化后 => once',
    api.classifyNoDisturbApprovalCandidate({ label: '1允许', context: '检测到受保护文件修改，需要你的确认', hasDeny: true, hasOnce: true, buttonCount: 2 }) === 'once',
    String(api.classifyNoDisturbApprovalCandidate({ label: '1允许', context: '检测到受保护文件修改，需要你的确认', hasDeny: true, hasOnce: true, buttonCount: 2 })));
  rec('分类器：「始终允许」=> session',
    api.classifyNoDisturbApprovalCandidate({ label: '始终允许', context: '需要你确认：权限', hasDeny: true, hasOnce: true, buttonCount: 2 }) === 'session',
    String(api.classifyNoDisturbApprovalCandidate({ label: '始终允许', context: '需要你确认：权限', hasDeny: true, hasOnce: true, buttonCount: 2 })));
  rec('分类器：通用「确认」不通过',
    api.classifyNoDisturbApprovalCandidate({ label: '确认', context: '确认删除该文件？', hasDeny: false, hasOnce: false, buttonCount: 2 }) === null,
    String(api.classifyNoDisturbApprovalCandidate({ label: '确认', context: '确认删除该文件？', hasDeny: false, hasOnce: false, buttonCount: 2 })));
  rec('分类器：禁用按钮不通过',
    api.classifyNoDisturbApprovalCandidate({ label: '允许', context: '需要你确认：权限', hasDeny: true, hasOnce: true, buttonCount: 2, disabled: true }) === null,
    String(api.classifyNoDisturbApprovalCandidate({ label: '允许', context: '需要你确认：权限', hasDeny: true, hasOnce: true, buttonCount: 2, disabled: true })));

  // 4) 回归主用例：首页带「积分」横幅时，确认弹窗仍必须被判为可点
  const banner = makeEl('div', '好友加入，积分上涨邀请一位好友可获得 100 积分');
  const wrapper = makeEl('div');
  const dialog = makeEl('div');
  dialog.setAttribute('role', 'dialog');
  dialog._text = '需要你确认：是否允许访问系统权限并执行该操作？';
  const btnAllow = makeEl('button', '允许');
  const btnDeny = makeEl('button', '拒绝');
  dialog.appendChild(btnAllow);
  dialog.appendChild(btnDeny);
  wrapper.appendChild(dialog);
  body.appendChild(banner);
  body.appendChild(wrapper);

  const ctx = api.ndApprovalContext(btnAllow);
  rec('回归：首页含积分横幅时，「允许」仍判定为 once', ctx && ctx.kind === 'once',
    'kind=' + (ctx && ctx.kind) + ' creditSeen=' + (ctx && ctx.creditSeen));
  rec('回归：判定上下文只取弹窗容器，不含首页积分文案',
    !!ctx && ctx.context.indexOf('积分') < 0, JSON.stringify(String(ctx && ctx.context).slice(0, 60)));

  // 5) 真正的扣费弹窗必须继续被挡住
  const billWrapper = makeEl('div');
  const bill = makeEl('div');
  bill._text = '本次生成将消耗 30 积分，是否确认？';
  const bAllow = makeEl('button', '允许');
  const bDeny = makeEl('button', '拒绝');
  bill.appendChild(bAllow);
  bill.appendChild(bDeny);
  billWrapper.appendChild(bill);
  body.appendChild(billWrapper);
  const billCtx = api.ndApprovalContext(bAllow);
  rec('扣费弹窗（弹窗自身含积分）仍被拒绝', billCtx && billCtx.kind === null,
    'kind=' + (billCtx && billCtx.kind));

  // 6) 通用确认弹窗（无扣费、非权限）不得被点
  const genericWrapper = makeEl('div');
  const generic = makeEl('div');
  generic._text = '确认删除该文件？';
  const gOk = makeEl('button', '确认');
  const gNo = makeEl('button', '取消');
  generic.appendChild(gOk);
  generic.appendChild(gNo);
  genericWrapper.appendChild(generic);
  body.appendChild(genericWrapper);
  const genericCtx = api.ndApprovalContext(gOk);
  rec('通用「确认/取消」弹窗不被自动点', genericCtx && genericCtx.kind === null,
    'kind=' + (genericCtx && genericCtx.kind));
}

const failed = results.filter((r) => !r.pass);
console.log('\n=== no-disturb 判定：' + (results.length - failed.length) + '/' + results.length + ' 通过 ===');
fs.writeFileSync(path.join(__dirname, 'no-disturb-report.json'),
  JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
