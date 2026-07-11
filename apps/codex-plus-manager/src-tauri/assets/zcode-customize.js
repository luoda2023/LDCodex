/**
 * LDZcode v3.6
 * 修复：
 *  - 调字号时输入框宽度也变化的 bug（用 *{font-size} 全局选择器副作用）
 *  - 输入框高度滑块不生效的 bug（min-height 被 !important 被覆盖）
 *  - 字号作用于消息内容区，不波及侧边栏/输入框/控件
 */
(function(){
'use strict';
var KEY='ldzcode_config';
var DEF={cw:64,iw:64,ih:10,fs:14};
function load(){
  try{var s=localStorage.getItem(KEY);return s?Object.assign({},DEF,JSON.parse(s)):Object.assign({},DEF)}
  catch(e){return Object.assign({},DEF)}
}
function save(c){try{localStorage.setItem(KEY,JSON.stringify(c))}catch(e){}
}
var C=load(),panel=null,overlay=null,visible=false;

function apply(){
  // 消息区宽度：限定到 main 容器内的 Tailwind max-* 元素，不波及输入框/侧栏
  var wMsg='main .max-w-2xl,main .max-w-3xl,main .max-w-4xl,main .max-w-5xl,main .max-w-xl,main .max-w-lg,main .max-w-md,main .max-w-sm{max-width:'+C.cw+'rem!important}';
  // 输入框容器宽度：与消息区解耦，独立 iw 控制
  var wComp='div[class*="composer"]{width:100%!important;max-width:'+C.iw+'rem!important;margin-left:auto!important;margin-right:auto!important;align-self:center!important}';
  // 输入框可编辑区：高度独立控制 !important
  var wEdit='[contenteditable="true"]{min-height:'+C.ih+'rem!important;height:auto!important;width:100%!important;max-width:none!important}';
  var r=document.getElementById('ldz-dyn-w');
  if(r) r.textContent=wMsg+wComp+wEdit;
  var f=document.getElementById('ldz-dyn-fs');
  // 字号只作用于消息内容区的文本节点，不波及侧栏/输入框/控件
  // 用简单选择器避免 Chromium 嵌套 :not 解析问题
  if(f) f.textContent=
    '.prose,.prose p,.prose li,.prose blockquote,.prose pre,.prose code,.prose h1,.prose h2,.prose h3,.prose h4,.prose h5,'+
    '[class*="markdown"] p,[class*="markdown"] li,[class*="markdown"] blockquote,[class*="markdown"] pre,[class*="markdown"] code,'+
    '[class*="markdown"] h1,[class*="markdown"] h2,[class*="markdown"] h3,[class*="markdown"] h4,'+
    'article p,article li,article blockquote,article pre,article code,'+
    'div[class*="message"] p,div[class*="message"] li,div[class*="message"] blockquote,div[class*="message"] pre,div[class*="message"] code'+
    '{font-size:'+C.fs+'px!important;line-height:1.6!important}';
}
function injectCSS(){
  if(document.getElementById('ldzcss'))return;
  var s=document.createElement('style');s.id='ldzcss';
  s.textContent=
    '#ldzcode-btn{position:fixed!important;z-index:2147483647!important;top:0.3cm!important;right:9cm!important;padding:2px 8px!important;border:none!important;border-radius:6px!important;background:rgba(25,50,150,0.7)!important;color:#fff!important;font:bold 11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;opacity:0.8!important;transition:opacity 0.2s!important;outline:none!important;white-space:nowrap!important;-webkit-app-region:no-drag!important}'+
    '#ldzcode-btn:hover{opacity:1!important;background:rgba(35,70,200,0.9)!important}'+
    '#ldz-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.5);opacity:0;pointer-events:none;transition:opacity 0.2s}'+
    '#ldz-overlay.open{opacity:1;pointer-events:auto}'+
    '#ldz-panel{all:initial;position:fixed;z-index:2147483647;left:50%;top:50%;width:420px;max-width:90vw;max-height:90vh;transform:translate(-50%,-50%) scale(0.96);background:#24242c;border:1px solid rgba(255,255,255,0.08);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important;color:#e8e8e8;opacity:0;pointer-events:none;transition:opacity 0.2s,transform 0.2s;display:flex;flex-direction:column;overflow:hidden}'+
    '#ldz-panel.open{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}'+
    '#ldz-panel *{box-sizing:border-box}'+
    '#ldz-panel .h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.06)}'+
    '#ldz-panel .h .t{font-size:16px;font-weight:600;color:#fff}'+
    '#ldz-panel .h .x{background:transparent;border:none;color:#888;font-size:20px;padding:2px 6px;border-radius:6px;cursor:pointer}'+
    '#ldz-panel .h .x:hover{background:rgba(255,255,255,0.08);color:#fff}'+
    '#ldz-panel .b{padding:8px 0;overflow-y:auto}'+
    '#ldz-panel .r{display:flex;align-items:center;justify-content:space-between;padding:12px 20px}'+
    '#ldz-panel .r:hover{background:rgba(255,255,255,0.03)}'+
    '#ldz-panel .r+.r{border-top:1px solid rgba(255,255,255,0.04)}'+
    '#ldz-panel .rt{flex:1;padding-right:16px}'+
    '#ldz-panel .rn{font-size:14px!important;color:#f0f0f0;margin-bottom:3px}'+
    '#ldz-panel .rd{font-size:12px!important;color:#888}'+
    '#ldz-panel .rr{display:flex;align-items:center;gap:10px;min-width:120px;justify-content:flex-end}'+
    '#ldz-panel .rv{font-size:13px!important;color:#aaa;min-width:42px;text-align:right}'+
    '#ldz-panel input[type=range]{-webkit-appearance:none;appearance:none;width:100px;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);outline:none;cursor:pointer;margin:4px 0}'+
    '#ldz-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#4b8df8;border:2px solid rgba(255,255,255,0.15);cursor:pointer}'+
    '#ldz-panel .f{display:flex;gap:10px;padding:14px 20px;border-top:1px solid rgba(255,255,255,0.06)}'+
    '#ldz-panel .fb{flex:1;padding:8px 0;border-radius:6px;font-size:13px!important;cursor:pointer;text-align:center;border:1px solid transparent;font-family:inherit}'+
    '#ldz-panel .fs{background:rgba(255,255,255,0.06);color:#bbb;border-color:rgba(255,255,255,0.08)}'+
    '#ldz-panel .fs:hover{background:rgba(255,255,255,0.12);color:#fff}'+
    '#ldz-panel .fp{background:#4b8df8;color:#fff}'+
    '#ldz-panel .fp:hover{background:#3a7ce7}'+
    '#ldz-panel .sw{position:relative;width:40px;height:22px;border-radius:11px;background:rgba(255,255,255,0.15);cursor:pointer;transition:0.2s;display:inline-block;flex-shrink:0}'+
    '#ldz-panel .sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:0.2s}'+
    '#ldz-panel .sw.on{background:#4b8df8}'+
    '#ldz-panel .sw.on::after{left:20px}'+
    '#ldz-panel .sep{border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;padding-bottom:4px}';
  document.head.appendChild(s);
  // 动态 CSS 规则（不会随 React 重建消失）
  var dw=document.createElement('style');dw.id='ldz-dyn-w';document.head.appendChild(dw);
  var df=document.createElement('style');df.id='ldz-dyn-fs';document.head.appendChild(df);
  apply(); // 立即写入规则
}
function buildPanel(){
  if(panel)return;
  overlay=document.createElement('div');overlay.id='ldz-overlay';overlay.onclick=hide;
  document.body.appendChild(overlay);
  panel=document.createElement('div');panel.id='ldz-panel';
  var h=document.createElement('div');h.className='h';
  h.innerHTML='<div class="t">LDZcode</div><button class="x">&times;</button>';
  h.querySelector('.x').onclick=hide;panel.appendChild(h);
  var b=document.createElement('div');b.className='b';
  function addSlider(id,label,desc,min,max,val,unit){
    var r=document.createElement('div');r.className='r';
    r.innerHTML='<div class="rt"><div class="rn">'+label+'</div><div class="rd">'+desc+'</div></div>'+
      '<div class="rr"><span class="rv" id="lv-'+id+'">'+val+unit+'</span>'+
      '<input type="range" id="ls-'+id+'" min="'+min+'" max="'+max+'" step="1" value="'+val+'"></div>';
    var sl=r.querySelector('input'),vl=r.querySelector('.rv');
    sl.oninput=function(){
      var v=parseFloat(sl.value);vl.textContent=v+unit;
      C[id]=v;
      // 全局宽度滑块联动 iw（保持消息区与输入框默认对齐；输入框单独控制可手动改 iw）
      if(id==='cw') C.iw=v;
      save(C);apply();
    };
    b.appendChild(r);
  }
  addSlider('cw','全局宽度','消息区 + 输入框统一宽度',24,120,C.cw,'rem');
  addSlider('ih','输入框高度','输入框最小高度',4,40,C.ih,'rem');
  addSlider('fs','文字大小','消息内容文字大小（不影响输入框/侧栏）',10,24,C.fs,'px');
  var sp=document.createElement('div');sp.className='r sep';
  sp.innerHTML='<div class="rt"><div class="rn" style="font-size:12px!important;color:#888">ZCode 设置</div></div>';b.appendChild(sp);
  var mr=document.createElement('div');mr.className='r';
  mr.innerHTML='<div class="rt"><div class="rn">并行对话</div><div class="rd" id="ldz-md">—</div></div>'+
    '<div class="rr"><span class="sw" id="ldz-ms"></span></div>';b.appendChild(mr);
  panel.appendChild(b);
  var f=document.createElement('div');f.className='f';
  f.innerHTML='<button class="fb fs" id="ldz-reset">恢复默认</button><button class="fb fp" id="ldz-done">完成</button>';
  f.querySelector('#ldz-reset').onclick=function(){
    C=Object.assign({},DEF);save(C);apply();
    ['cw','ih','fs'].forEach(function(k){
      document.getElementById('ls-'+k).value=C[k];
      document.getElementById('lv-'+k).textContent=C[k]+(k==='fs'?'px':'rem');
    });
  };
  f.querySelector('#ldz-done').onclick=hide;panel.appendChild(f);
  document.body.appendChild(panel);
  // 并行开关
  var ms=document.getElementById('ldz-ms');
  var md=document.getElementById('ldz-md');
  if(ms){
    ms.onclick=function(){
      var on=this.className.indexOf('on')>=0;
      var mode=on?'queue':'parallel';
      this.className=mode==='parallel'?'sw on':'sw';
      md.textContent=mode==='parallel'?'已开启 ✓ 重启生效':'已关闭 重启生效';
      try{window.zcode&&window.zcode.syncAppSettings&&window.zcode.syncAppSettings({zcodeInteractionBehavior:mode});}catch(e){}
    };
    try{if(localStorage.getItem('ldz_p')==='1'){ms.className='sw on';md.textContent='已开启 ✓ 重启生效';}}catch(e){}
  }
}
function createButton(){
  if(document.getElementById('ldzcode-btn'))return;
  var btn=document.createElement('button');
  btn.id='ldzcode-btn';btn.textContent='LDZcode';
  btn.title='LDZcode (Alt+L)';
  btn.onclick=function(e){e.stopPropagation();toggle()};
  document.body.appendChild(btn);
}
function show(){visible=true;overlay.classList.add('open');panel.classList.add('open')}
function hide(){visible=false;overlay.classList.remove('open');panel.classList.remove('open')}
function toggle(){if(visible)hide();else show()}
function init(){
  if(window.__ldzLoaded)return;
  window.__ldzLoaded=true;
  injectCSS();buildPanel();createButton();
  document.addEventListener('keydown',function(e){
    if(e.altKey&&(e.key==='l'||e.key==='L')){e.preventDefault();e.stopPropagation();toggle()}
    if(e.key==='Escape'&&visible)hide();
  });
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else setTimeout(init,50);
})();
