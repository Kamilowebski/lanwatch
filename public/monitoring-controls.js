(() => {
  const $=id=>document.getElementById(id);
  let loading=false,dirty=false,busy=false,loadedForm=false;
  const fields={intervalSeconds:'monitor-interval',attempts:'monitor-attempts',concurrency:'monitor-concurrency',failureThreshold:'monitor-threshold'};
  const paused=device=>{
    const settings=window.monitorRuntime?.settings;
    return !!settings && (settings.paused || settings.pausedGroups.includes((device.groupName||'').trim().toLocaleLowerCase('pl')));
  };
  window.matchesMonitorFilter=device=>{
    const query=$('monitor-search').value.trim().toLocaleLowerCase('pl');
    return (!$('monitor-problems').checked || device.status!=='online') && (!query || [device.hostName,device.ip,device.groupName,device.monitorNote,...(device.tags||[])].some(value=>(value||'').toLocaleLowerCase('pl').includes(query)));
  };
  window.confirmPingSeries=subject=>{
    const ids=Array.isArray(subject)?subject:[...new Set([subject.id,...devices.filter(device=>(subject.groupName||'').trim() && device.groupName.trim().toLocaleLowerCase('pl')===(subject.groupName||'').trim().toLocaleLowerCase('pl')).map(device=>device.id)])];
    if(!Array.isArray(subject)) for(const device of devices.filter(device=>ids.includes(device.id))) for(const id of device.dependencyIds)if(!ids.includes(id))ids.push(id);
    const attempts=window.monitorRuntime?.settings.attempts||5;
    return ids.length<20 || window.confirm(`Sprawdzić ${ids.length} maszyn? Maksymalnie ${ids.length*attempts} prób ICMP (${attempts} na maszynę). Ruch będzie widoczny w sieci.`);
  };
  window.refreshMonitorExtras=()=>{
    const byId=new Map(devices.map(device=>[device.id,device]));
    const threshold=window.monitorRuntime?.settings.failureThreshold||3;
    for(const row of $('monitor-list').rows){
      const device=byId.get(Number(row.dataset.deviceId));if(!device)continue;
      let badge=row.querySelector('.monitor-pause-badge');
      if(!badge){badge=document.createElement('small');badge.className='monitor-pause-badge';row.querySelector('.host-cell').append(badge);}
      badge.textContent=paused(device)?'Pauza':'';badge.title='Wstrzymano automatyczne sprawdzanie; ręczny ping nadal działa.';badge.hidden=!paused(device);
      let hint=row.querySelector('.monitor-dependency-hint');
      if(!hint){hint=document.createElement('small');hint.className='monitor-dependency-hint';row.querySelector('.host-cell').append(hint);}
      const failed=[],visited=new Set([device.id]),queue=[device];
      if(device.status==='offline')for(let i=0;i<queue.length;i++)for(const id of queue[i].dependencyIds){if(visited.has(id))continue;visited.add(id);const target=byId.get(id);if(!target)continue;if(target.status==='offline')failed.push(target.hostName);queue.push(target);}
      hint.textContent=failed.length?`Sprawdź najpierw: ${failed.slice(0,3).join(', ')}${failed.length>3?` +${failed.length-3}`:''}. Zależność również nie odpowiada — to wskazówka, nie pewna przyczyna.`:'';hint.title=hint.textContent;hint.hidden=!failed.length;
      let streak=row.querySelector('.monitor-failure-streak');
      if(!streak){streak=document.createElement('small');streak.className='monitor-failure-streak';row.querySelector('.monitor-status').parentElement.append(streak);}
      streak.textContent=device.status==='offline'?((device.failureStreak||0)<threshold?`Potwierdzanie: ${device.failureStreak||0}/${threshold}`:`Potwierdzono: ${device.failureStreak} kolejnych`):'';
      streak.hidden=device.status!=='offline';
    }
  };
  function renderRuntime(){
    const runtime=window.monitorRuntime;if(!runtime)return;
    const settings=runtime.settings;
    $('monitor-pause-all').textContent=settings.paused?'Wznów monitor':'Wstrzymaj monitor';
    const select=$('monitor-pause-group'),selected=select.value;
    const groups=new Map();
    for(const device of devices.filter(device=>device.monitorEnabled)){const name=(device.groupName||'').trim();groups.set(name.toLocaleLowerCase('pl'),name);}
    for(const name of settings.pausedGroups)if(!groups.has(name))groups.set(name,name);
    const nextOptions=[...groups].map(([key,name])=>[key,name||'Bez grupy']);
    if(JSON.stringify([...select.options].map(option=>[option.value,option.text]))!==JSON.stringify(nextOptions)){
      select.replaceChildren();for(const [key,name] of nextOptions)select.add(new Option(name,key));
    }
    if(groups.has(selected))select.value=selected;
    $('monitor-pause-selected').disabled=!groups.size||busy;
    $('monitor-pause-selected').textContent=settings.pausedGroups.includes(select.value)?'Wznów grupę':'Wstrzymaj grupę';
    const last=runtime.lastCycleFinished?new Date(runtime.lastCycleFinished).toLocaleTimeString('pl-PL'):'jeszcze brak';
    $('monitor-runtime-status').textContent=`${settings.paused?'Monitor wstrzymany':runtime.running?`Cykl: ${runtime.cycleCompleted}/${runtime.cycleTotal}`:'Oczekiwanie na cykl'} · W trakcie: ${runtime.active} · Kolejka: ${runtime.queued} · Ostatni koniec: ${last}${runtime.lastCycleDurationMs!==null?` (${(runtime.lastCycleDurationMs/1000).toFixed(1)} s)`:''} · Interwał: ${settings.intervalSeconds} s · Wstrzymane grupy: ${settings.pausedGroups.length}`;
    if(!dirty){for(const [key,id] of Object.entries(fields))$(id).value=settings[key];loadedForm=true;}
    window.refreshMonitorExtras();
  }
  async function load(){
    if(loading)return;loading=true;
    try{window.monitorRuntime=await api('/api/monitor/runtime');renderRuntime();}
    catch(error){$('monitor-runtime-status').textContent=`Nie można pobrać stanu monitora: ${error.message}`;console.error('monitor.runtime',error);}
    finally{loading=false;}
  }
  async function pause(body){
    if(busy)return;busy=true;$('monitor-pause-all').disabled=true;$('monitor-pause-selected').disabled=true;
    try{await api('/api/monitor/pause',{method:'PUT',body:JSON.stringify(body)});await load();await refresh({preserveInventory:true});}
    catch(error){notify(error.message,'danger');}
    finally{busy=false;$('monitor-pause-all').disabled=false;renderRuntime();}
  }
  $('monitor-pause-all').addEventListener('click',()=>{if(window.monitorRuntime)pause({paused:!window.monitorRuntime.settings.paused});});
  $('monitor-pause-selected').addEventListener('click',()=>{if(window.monitorRuntime)pause({paused:!window.monitorRuntime.settings.pausedGroups.includes($('monitor-pause-group').value),groupName:$('monitor-pause-group').value});});
  $('monitor-pause-group').addEventListener('change',()=>{if(window.monitorRuntime)$('monitor-pause-selected').textContent=window.monitorRuntime.settings.pausedGroups.includes($('monitor-pause-group').value)?'Wznów grupę':'Wstrzymaj grupę';});
  for(const id of ['monitor-search','monitor-problems'])$(id).addEventListener('input',()=>renderMonitor());
  $('monitor-settings-form').addEventListener('input',()=>dirty=true);
  $('monitor-settings-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!loadedForm||busy)return;
    const changes=Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,Number($(id).value)]));
    const button=event.submitter;busy=true;button.disabled=true;
    try{await api('/api/monitor/settings',{method:'PUT',body:JSON.stringify(changes)});dirty=false;await load();await refresh({preserveInventory:true});$('monitor-settings-status').textContent='Ustawienia zapisano. Nowe próby użyją aktualnych ustawień.';}
    catch(error){$('monitor-settings-status').textContent=error.message;notify(error.message,'danger');}
    finally{busy=false;button.disabled=false;}
  });
  document.querySelector('[data-view="monitor-view"]').addEventListener('click',load);
  load();setInterval(load,5000);
})();
