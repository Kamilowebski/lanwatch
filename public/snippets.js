(() => {
  const $ = id => document.getElementById(id);
  let entries=[],version=0,editingId=null,busy=false;
  const form=$('snippet-form'),dialog=$('snippet-dialog');
  function button(text,action,className='monitor-action') {
    const element=document.createElement('button');element.type='button';element.className=className;element.textContent=text;
    element.addEventListener('click',action);return element;
  }
  function updateCategories() {
    const select=$('snippet-category'),previous=select.value;
    select.replaceChildren(new Option('Wszystkie kategorie',''));
    for(const name of [...new Set(entries.map(entry=>entry.category))].sort((a,b)=>a.localeCompare(b,'pl'))) select.add(new Option(name,name));
    select.value=[...select.options].some(option=>option.value===previous)?previous:'';
  }
  async function copy(text,control) {
    try {
      await copyPlainText(text,control);
      control.textContent='Skopiowano';
      window.setTimeout(()=>{if(control.isConnected)control.textContent='Kopiuj';},1800);
    }catch(error){notify(error.message,'danger');}
  }
  function render() {
    const query=$('snippet-search').value.trim().toLocaleLowerCase('pl');
    const filtered=entries.filter(entry=>(!$('snippet-platform').value || entry.platform===$('snippet-platform').value)
      && (!$('snippet-category').value || entry.category===$('snippet-category').value)
      && (!$('snippet-favorites').checked || entry.favorite)
      && [entry.title,entry.description,entry.command,entry.tags,entry.category,entry.shell].join(' ').toLocaleLowerCase('pl').includes(query)).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.title.localeCompare(b.title,'pl'));
    $('snippet-count').textContent=`${filtered.length} z ${entries.length} wpisów`;
    const list=$('snippet-list');list.replaceChildren();
    for(const entry of filtered) {
      const card=document.createElement('article');card.className='snippet-card';
      const header=document.createElement('header');const title=document.createElement('h2');title.textContent=entry.title;
      const favorite=button(entry.favorite?'★':'☆',async()=>{
        if(favorite.disabled)return;favorite.disabled=true;
        try {const result=await api(`/api/snippets/${entry.id}/favorite`,{method:'PUT',body:JSON.stringify({favorite:!entry.favorite})});version++;entries=entries.map(item=>item.id===entry.id?result:item);render();}
        catch(error){notify(error.message,'danger');favorite.disabled=false;}
      },'snippet-star');
      favorite.setAttribute('aria-label',`Ulubiony: ${entry.title}`);favorite.setAttribute('aria-pressed',String(entry.favorite));header.append(title,favorite);
      const meta=document.createElement('div');meta.className='snippet-meta';
      for(const label of [entry.platform,entry.shell,entry.category]){const tag=document.createElement('span');tag.textContent=label;meta.append(tag);}
      const description=document.createElement('p');description.className='snippet-description';description.textContent=entry.description;
      const pre=document.createElement('pre');pre.tabIndex=0;pre.setAttribute('aria-label',`Treść: ${entry.title}`);
      const code=document.createElement('code');code.textContent=entry.command;pre.append(code);
      const tags=document.createElement('small');tags.className='snippet-tags';tags.textContent=entry.tags;
      const actions=document.createElement('footer');
      const copyButton=button('Kopiuj',()=>copy(entry.command,copyButton),'monitor-action monitor-action-primary');
      const edit=button('Edytuj',()=>openForm(entry),'monitor-text-action');
      const remove=button('Usuń',async()=>{
        if(!window.confirm(`Usunąć wpis „${entry.title}”?`))return;
        remove.disabled=true;
        try {await api(`/api/snippets/${entry.id}`,{method:'DELETE'});version++;entries=entries.filter(item=>item.id!==entry.id);updateCategories();render();}
        catch(error){notify(error.message,'danger');remove.disabled=false;}
      },'monitor-text-action snippet-remove');
      actions.append(copyButton,edit,remove);card.append(header,meta,description,pre,tags,actions);list.append(card);
    }
    if(!filtered.length){const empty=document.createElement('p');empty.className='snippet-empty';empty.textContent=entries.length?'Brak pasujących wpisów. Zmień wyszukiwanie lub filtry.':'Biblioteka jest pusta. Dodaj własny wpis lub importuj JSON.';list.append(empty);}
  }
  async function load() {
    const token=++version;$('snippet-message').textContent='Wczytywanie biblioteki…';
    try {
      const next=await api('/api/snippets');if(token!==version)return;
      entries=next;updateCategories();render();$('snippet-message').textContent='';
    }catch(error){if(token===version)$('snippet-message').textContent=error.message;}
  }
  function openForm(entry=null) {
    if(busy)return;form.reset();editingId=entry?.id ?? null;
    $('snippet-dialog-title').textContent=entry?'Edytuj wpis':'Dodaj wpis';$('snippet-form-error').hidden=true;
    for(const key of ['title','description','platform','shell','category','tags','command']) {
      form.elements.namedItem(key).value=entry?.[key] ?? (key==='platform'?'Windows':key==='category'?'Sieć':'');
    }
    $('snippet-edit-favorite').checked=Boolean(entry?.favorite);dialog.showModal();$('snippet-title').focus();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !form.reportValidity())return;
    busy=true;$('snippet-save').disabled=true;$('snippet-save').textContent='Zapisywanie…';$('snippet-form-error').hidden=true;
    const body=Object.fromEntries(new FormData(form));body.favorite=$('snippet-edit-favorite').checked;
    try {
      const result=await api(editingId?`/api/snippets/${editingId}`:'/api/snippets',{method:editingId?'PUT':'POST',body:JSON.stringify(body)});
      version++;
      entries=editingId?entries.map(entry=>entry.id===editingId?result:entry):[result,...entries];
      entries.sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.title.localeCompare(b.title,'pl'));
      dialog.close();updateCategories();render();notify('Wpis został zapisany.');
    }catch(error){$('snippet-form-error').textContent=error.message;$('snippet-form-error').hidden=false;}
    finally{busy=false;$('snippet-save').disabled=false;$('snippet-save').textContent='Zapisz wpis';}
  });
  $('snippet-add').addEventListener('click',()=>openForm());
  $('snippet-refresh').addEventListener('click',load);
  for(const id of ['snippet-search','snippet-platform','snippet-category','snippet-favorites'])$(id).addEventListener(id==='snippet-search'?'input':'change',render);
  document.querySelector('[data-view="snippets-view"]').addEventListener('click',load);
  $('snippet-export').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({version:1,snippets:entries.map(({title,description,platform,shell,category,tags,command,favorite})=>({title,description,platform,shell,category,tags,command,favorite}))},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='lanwatch-komendy.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('snippet-import').addEventListener('click',()=>$('snippet-file').click());
  $('snippet-file').addEventListener('change',async()=>{
    const file=$('snippet-file').files[0];if(!file)return;
    $('snippet-file').value='';const control=$('snippet-import');if(control.disabled)return;control.disabled=true;
    try {
      if(file.size>900000)throw Error('Plik jest zbyt duży (limit 900 KB).');
      const body=JSON.parse(await file.text());
      if(body.version!==1 || !Array.isArray(body.snippets) || body.snippets.length>200)throw Error('Wymagany JSON wersji 1, do 200 wpisów.');
      if(!window.confirm(`Dodać ${body.snippets.length} wpisów? Duplikaty treści w tym samym systemie i powłoce zostaną pominięte.`))return;
      const result=await api('/api/snippets/import',{method:'POST',body:JSON.stringify(body)});
      notify(`Dodano: ${result.imported}. Pominięto duplikaty: ${result.skipped}.`);await load();
    }catch(error){notify(error.message,'danger');}
    finally{control.disabled=false;}
  });
})();
