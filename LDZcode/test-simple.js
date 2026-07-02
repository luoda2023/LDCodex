document.addEventListener('DOMContentLoaded', function(){
  var b = document.createElement('div');
  b.id = 'ldzcode-btn';
  b.textContent = 'L';
  b.style.cssText = 'position:fixed;top:5px;right:5px;z-index:999999;background:red;color:#fff;padding:5px 10px;border-radius:5px;font:bold 14px sans-serif;cursor:pointer;';
  document.body.appendChild(b);
  console.log('[LDZtest] LOADED');
});
