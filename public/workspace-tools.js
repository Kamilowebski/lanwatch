(() => {
 const $=id=>document.getElementById(id);
 let views=[];
 function filters(scope){return scope==='inventory'?{query:elements.search.value,tag:$('inventory-tag-filter').value,category:categoryFilter,location:locationFilter,status:statusFilter,quick:quickFilter,problems:$('inventory-problem-groups').checked}:{query:$('monitor-search').value,problems:$('monitor-problems').checked,offlineFirst};}
 function apply(view){const f=view.filters;
  if(view.scope==='inventory'){
   elements.search.value=f.query||'';categoryFilter=categories.some(item=>String(item.id)===f.category)?f.category:'';locationFilter=locations.some(item=>item.name===f.location)?f.location:'';statusFilter=f.status||'';quickFilter=f.quick||'all';
   if(f.tag && ![...$('inventory-tag-filter').options].some(option=>option.value===f.tag))$('inventory-tag-filter').add(new Option(f.tag,f.tag));
   $('inventory-tag-filter').value=f.tag||'';
   elements.filterCategory.value=categoryFilter;elements.filterLocation.value=locationFilter;elements.filterStatus.value=statusFilter;
   $('inventory-problem-groups').checked=!!f.problems;savePreference('lanwatch-problem-groups',String(!!f.problems));currentPage=1;renderDevices();
  }else{
   $('monitor-search').value=f.query||'';$('monitor-problems').checked=!!f.problems;offlineFirst=!!f.offlineFirst;$('monitor-offline-first').checked=offlineFirst;savePreference('lanwatch-monitor-offline-first',String(offlineFirst));renderMonitor();
  }
 }
 const controls=[];
 function options(){for(const {scope,select} of controls){const current=select.value;select.replaceChildren(new Option('Wybierz zapisany widok',''));for(const view of views.filter(view=>view.scope===scope))select.add(new Option(view.name,view.id));select.value=views.some(view=>view.id===current)?current:'';}}
 for(const scope of ['inventory','monitor']){
  const panel=document.querySelector(scope==='inventory'?'#inventory-view .inventory-panel':'#monitor-view .monitor-panel');
  const form=document.createElement('form');form.className='saved-view-toolbar';form.setAttribute('aria-label',`Zapisane widoki: ${scope==='inventory'?'Maszyny':'Monitor'}`);
  const select=document.createElement('select');select.className='form-select';select.setAttribute('aria-label','Zapisany widok');
  const name=document.createElement('input');name.className='form-control';name.maxLength=60;name.placeholder='Nazwa nowego widoku';name.setAttribute('aria-label','Nazwa nowego widoku');
  const save=document.createElement('button');save.type='submit';save.className='monitor-action';save.textContent='Zapisz widok';
  const remove=document.createElement('button');remove.type='button';remove.className='monitor-text-action';remove.textContent='Usuń widok';
  const status=document.createElement('span');status.className='saved-view-status';status.setAttribute('role','status');
  form.append(select,name,save,remove,status);panel.querySelector('.inventory-heading').after(form);controls.push({scope,select});
  select.addEventListener('change',()=>{const view=views.find(view=>view.id===select.value);if(!view){status.textContent='Wybierz widok.';return;}apply(view);status.textContent='Widok zastosowano.';});
  form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled)return;if(!name.value.trim()){status.textContent='Podaj nazwę widoku.';name.focus();return;}save.disabled=true;try{const result=await api('/api/saved-views',{method:'POST',body:JSON.stringify({name:name.value,scope,filters:filters(scope)})});views.push(result);options();select.value=result.id;name.value='';status.textContent='Widok zapisano w bazie.';}catch(error){status.textContent=error.message;}finally{save.disabled=false;}});
  remove.addEventListener('click',async()=>{const id=select.value;if(!id){status.textContent='Wybierz widok.';return;}if(remove.disabled)return;remove.disabled=true;try{await api('/api/saved-views/'+id,{method:'DELETE'});views=views.filter(view=>view.id!==id);options();status.textContent='Widok usunięto.';}catch(error){status.textContent=error.message;}finally{remove.disabled=false;}});
 }
 api('/api/saved-views').then(result=>{views=result.items;options();}).catch(error=>{document.querySelectorAll('.saved-view-status').forEach(node=>node.textContent=error.message);});
 api('/api/group-summaries').then(result=>{
  for(const item of result.items){const old=groupCheckSummaries.get(item.memberKey);if(old&&old.finishedAt>item.finishedAt)continue;const s=item.summary;groupCheckSummaries.set(item.memberKey,{finishedAt:item.finishedAt,message:`${s.online} online · ${s.offline} bez odpowiedzi · ${s.unknown} nieustalonych`});}renderDevices();
 }).catch(error=>notify(`Nie można pobrać podsumowań grup: ${error.message}`,'warning'));
 $('backup-create').addEventListener('click',async()=>{const button=$('backup-create');if(button.disabled)return;button.disabled=true;button.textContent='Tworzenie kopii…';try{const result=await api('/api/backups/create',{method:'POST',timeoutMs:135000});await refreshBackupStatus();$('backup-state').textContent=`Nowa kopia gotowa: ${result.file}`;notify('Utworzono nową kopię zapasową.','success');}catch(error){$('backup-state').textContent=error.message;notify(error.message,'danger');}finally{button.disabled=false;button.textContent='Utwórz kopię teraz';}});
 const dialog=$('machine-events-dialog'),list=$('machine-events-list'),more=$('machine-events-more'),message=$('machine-events-message');
 let eventDevice=null,eventCursor=null,eventVersion=0,eventLoading=false;
 const labels={failure:'Pierwszy brak odpowiedzi w serii',confirmed:'Potwierdzona awaria',recovery:'Powrót online'};
 async function loadEvents(append=false){
  if(eventLoading)return;eventLoading=true;more.disabled=true;const token=eventVersion;
  try{const result=await api(`/api/devices/${eventDevice.id}/events${append&&eventCursor?'?before='+eventCursor:''}`);if(token!==eventVersion)return;if(!append)list.replaceChildren();for(const item of result.items){const row=document.createElement('li');const time=document.createElement('time');time.dateTime=item.recordedAt;time.textContent=new Date(item.recordedAt).toLocaleString('pl-PL');const text=document.createElement('span');text.textContent=labels[item.kind]+(item.kind==='confirmed'?` (próg: ${item.threshold})`:'');row.append(time,text);list.append(row);}eventCursor=result.nextBefore;more.hidden=!eventCursor;message.textContent=list.children.length?'Zdarzenia zapisane od wersji 1.6.0; nie są odtwarzane z wcześniejszych pomiarów.':'Brak zapisanych zdarzeń. Historia zaczyna się od wersji 1.6.0.';}catch(error){if(token===eventVersion)message.textContent=error.message;}finally{if(token===eventVersion){eventLoading=false;more.disabled=false;}}
 }
 window.openMachineEvents=device=>{eventVersion++;eventDevice=device;eventCursor=null;eventLoading=false;list.replaceChildren();more.hidden=true;$('machine-events-title').textContent=`Zdarzenia: ${device.hostName}`;message.textContent='Wczytywanie…';if(!dialog.open)dialog.showModal();loadEvents();};
 more.addEventListener('click',()=>loadEvents(true));dialog.addEventListener('close',()=>{if(!dialog.open){eventVersion++;eventLoading=false;}});
})();
