(() => {
  const $=id=>document.getElementById(id), selected=new Set();
  let busy=false,editIds=[],importText=null,importVersion=0,importBusy=false;
  const dialog=$('bulk-edit-dialog');
  window.createInventorySelectionCell=(ids,label)=>{
    const cell=document.createElement('td');cell.className='inventory-select-cell';
    const input=document.createElement('input');input.type='checkbox';input.className='inventory-device-select';input.dataset.ids=ids.join(',');
    input.setAttribute('aria-label',`Zaznacz: ${label}`);
    input.addEventListener('change',()=>{for(const id of ids)input.checked?selected.add(id):selected.delete(id);window.syncInventorySelection();});
    cell.append(input);return cell;
  };
  window.syncInventorySelection=()=>{
    const existing=new Set(devices.map(device=>device.id));
    for(const id of selected)if(!existing.has(id))selected.delete(id);
    document.querySelectorAll('.inventory-device-select').forEach(input=>{
      const ids=input.dataset.ids.split(',').map(Number),count=ids.filter(id=>selected.has(id)).length;
      input.checked=count===ids.length;input.indeterminate=count>0&&count<ids.length;input.disabled=busy;
    });
    const page=$('inventory-select-page'),count=visiblePageDeviceIds.filter(id=>selected.has(id)).length;
    page.checked=!!visiblePageDeviceIds.length&&count===visiblePageDeviceIds.length;
    page.indeterminate=count>0&&count<visiblePageDeviceIds.length;page.disabled=busy||!visiblePageDeviceIds.length;
    $('inventory-bulk-bar').hidden=selected.size===0;
    $('inventory-selected-count').textContent=`Zaznaczono: ${selected.size} maszyn (ze wszystkich stron)`;
    $('inventory-bulk-bar').querySelectorAll('button').forEach(button=>button.disabled=busy);
  };
  $('inventory-select-page').addEventListener('change',event=>{
    for(const id of visiblePageDeviceIds)event.target.checked?selected.add(id):selected.delete(id);
    window.syncInventorySelection();
  });
  $('bulk-clear').addEventListener('click',()=>{selected.clear();window.syncInventorySelection();});
  function options(select,items) {
    select.replaceChildren(new Option('Bez zmian',''));
    for(const item of items)select.add(new Option(item.name,item.value));
  }
  $('bulk-change').addEventListener('click',()=>{
    editIds=[...selected];$('bulk-edit-title').textContent=`Zmień maszyny: ${editIds.length}`;
    options($('bulk-location'),locations.map(item=>({name:item.name,value:item.name})));
    options($('bulk-category'),categories.map(item=>({name:item.name,value:item.id})));
    $('bulk-edit-error').hidden=true;dialog.showModal();
  });
  async function apply(ids,changes) {
    const result=await api('/api/devices/bulk',{method:'PUT',body:JSON.stringify({deviceIds:ids,changes})});
    ids.forEach(id=>selected.delete(id));
    notify(changes.monitorEnabled === true ? `Monitorowanie włączone dla ${result.monitored} maszyn, w tym dodatkowe zależności: ${result.dependenciesAdded}.` : `Zmieniono maszyny: ${result.updated}.`);
    return result;
  }
  async function reloadAfterChange() {
    try {await refresh();}catch(error){notify(`Zmiany zapisano, ale odświeżenie nie powiodło się: ${error.message}`,'warning');}
  }
  $('bulk-edit-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const changes={};
    if($('bulk-location').value)changes.location=$('bulk-location').value;
    if($('bulk-category').value)changes.categoryId=Number($('bulk-category').value);
    const error=$('bulk-edit-error');error.hidden=true;
    if(!Object.keys(changes).length){error.textContent='Wybierz lokalizację lub kategorię do zmiany.';error.hidden=false;return;}
    busy=true;$('bulk-save').disabled=true;window.syncInventorySelection();
    try {await apply(editIds,changes);dialog.close();await reloadAfterChange();}
    catch(cause){error.textContent=cause.message;error.hidden=false;}
    finally{busy=false;$('bulk-save').disabled=false;window.syncInventorySelection();}
  });
  async function monitor(enabled) {
    if(busy || !selected.size)return;
    const ids=[...selected];
    if(!window.confirm(`${enabled?'Włączyć':'Wyłączyć'} monitorowanie ${ids.length} maszyn?${enabled?' Zostaną również włączone wszystkie ich zależności, także pośrednie.':' Notatki monitora zostaną usunięte.'}`))return;
    busy=true;window.syncInventorySelection();
    try {await apply(ids,{monitorEnabled:enabled});await reloadAfterChange();}
    catch(error){notify(error.message,'danger');}
    finally{busy=false;window.syncInventorySelection();}
  }
  $('bulk-monitor-on').addEventListener('click',()=>monitor(true));
  $('bulk-monitor-off').addEventListener('click',()=>monitor(false));
  const importDialog=$('device-import-dialog');
  importDialog.addEventListener('close',()=>{if(!importDialog.open){importVersion++;importText=null;}});
  $('device-csv-import').addEventListener('click',()=>{if(!importBusy)$('device-csv-file').click();});
  $('device-csv-file').addEventListener('change',async()=>{
    const file=$('device-csv-file').files[0];$('device-csv-file').value='';if(!file || importBusy)return;
    const token=++importVersion;importText=null;
    $('device-import-confirm').disabled=true;$('device-import-error').hidden=true;
    $('device-import-file-name').textContent=file.name;$('device-import-summary').textContent='Sprawdzanie pliku…';
    if(!importDialog.open)importDialog.showModal();
    try {
      if(file.size>900000)throw Error('Plik przekracza 900 KB. Podziel go na mniejsze pliki.');
      const text=await file.text();
      const summary=await api('/api/devices/import/preview',{method:'POST',body:JSON.stringify({csv:text})});
      if(token!==importVersion)return;
      importText=text;
      $('device-import-summary').textContent=`Gotowe do dodania: ${summary.imported} maszyn. Nowe kategorie: ${summary.newCategories.join(', ') || 'brak'}. Nowe lokalizacje: ${summary.newLocations.join(', ') || 'brak'}.`;
      $('device-import-confirm').disabled=false;
    }catch(error){if(token===importVersion){$('device-import-summary').textContent='Import nie jest gotowy.';$('device-import-error').textContent=error.message;$('device-import-error').hidden=false;}}
  });
  $('device-import-confirm').addEventListener('click',async()=>{
    if(importBusy || importText===null)return;
    importBusy=true;$('device-csv-import').disabled=true;const token=importVersion,text=importText;
    $('device-import-confirm').disabled=true;
    try {
      const result=await api('/api/devices/import',{method:'POST',body:JSON.stringify({csv:text})});
      if(token===importVersion)importDialog.close();
      notify(`Zaimportowano maszyny: ${result.imported}.`);await reloadAfterChange();
    }catch(error){if(token===importVersion){$('device-import-error').textContent=error.message;$('device-import-error').hidden=false;}else notify(error.message,'danger');}
    finally{importBusy=false;$('device-csv-import').disabled=false;if(token===importVersion)$('device-import-confirm').disabled=importText===null;}
  });
})();
