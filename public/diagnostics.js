(() => {
  let sending = 0;
  const recent = [];
  function report(event, details = {}, level = 'error') {
    const entry = {time:new Date().toISOString(),event,level,...details};
    recent.push(entry);
    if (recent.length > 100) recent.shift();
    try { sessionStorage.setItem('lanwatch-diagnostics',JSON.stringify(recent)); } catch {}
    (level === 'warn' ? console.warn : console.error)('[Lanwatch]',event,details);
    if (sending >= 3) return;
    sending++;
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),3000);
    // Intentionally use fetch directly: a failed log upload must not log itself.
    fetch('/api/client-errors', {method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json'},body:JSON.stringify(entry)})
      .catch(()=>{}).finally(()=>{clearTimeout(timer);sending--;});
  }
  window.lanwatchDiagnostics = { report, recent };
  window.addEventListener('error',event=>{
    if(event.error || event.message) report('browser.error',{message:event.message,stack:String(event.error?.stack || '').slice(0,6000),file:event.filename,line:event.lineno});
    else if(event.target?.tagName) report('browser.resource_error',{tag:event.target.tagName,file:event.target.src || event.target.href},'warn');
  },true);
  window.addEventListener('unhandledrejection',event=>report('browser.unhandled_rejection',{
    message:String(event.reason?.message || event.reason),stack:String(event.reason?.stack || '').slice(0,6000)}));
  let last=performance.now();
  setInterval(()=>{
    const now=performance.now(),gap=now-last;last=now;
    if(document.visibilityState==='visible' && gap>10000) report('browser.event_loop_delayed',{gapMs:Math.round(gap)},'warn');
  },2000);
  document.addEventListener('visibilitychange',()=>{last=performance.now();});
})();
