(() => {
  const $=id=>document.getElementById(id),pendingFavorites=new Set();
  window.isDeviceFavoritePending=id=>pendingFavorites.has(id);
  window.toggleDeviceFavorite=async(id,favorite,button)=>{
    if(pendingFavorites.has(id))return;
    pendingFavorites.add(id);button.disabled=true;
    try {
      await api(`/api/devices/${id}/favorite`,{method:'PUT',body:JSON.stringify({favorite})});
      await refresh();
    }catch(error){notify(error.message,'danger');}
    finally{pendingFavorites.delete(id);if(button.isConnected)button.disabled=false;renderDevices();}
  };
  let retention=7;
  async function loadRetention() {
    const state=$('history-settings-status');state.textContent='Wczytywanie…';
    try {const result=await api('/api/history/settings');retention=result.retentionDays;$('history-retention-days').value=String(retention);state.textContent=`Zapisany okres: ${retention} dni.`;}
    catch(error){state.textContent=error.message;}
  }
  $('history-settings-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('history-settings-save');if(button.disabled)return;
    const days=Number($('history-retention-days').value);
    if(days<retention && !window.confirm(`Skrócić historię do ${days} dni? Starsze wyniki zostaną usunięte i nie można ich odtworzyć bez kopii bazy.`))return;
    button.disabled=true;$('history-settings-status').textContent='Zapisywanie…';
    try {const result=await api('/api/history/settings',{method:'PUT',body:JSON.stringify({retentionDays:days})});retention=result.retentionDays;$('history-settings-status').textContent=`Zapisano ${retention} dni. Starsze wyniki są usuwane w tle.`;}
    catch(error){$('history-settings-status').textContent=error.message;}
    finally{button.disabled=false;}
  });
  document.querySelector('[data-view="settings-view"]').addEventListener('click',loadRetention);

  const fieldNames={hostName:'Nazwa hosta',ip:'IPv4',groupName:'Grupa',location:'Lokalizacja',category:'Kategoria',description:'Opis',lineNumber:'Numer linii',numerator:'Numerator',dependencies:'Zależności',tags:'Tagi'};
  const actions={create:'Dodanie',update:'Edycja',delete:'Usunięcie',dependencies:'Zależności',tags:'Tagi',bulk:'Zmiana zbiorcza',classification:'Zmiana nazwy kategorii / lokalizacji',restore:'Przywrócenie'};
  let changesVersion=0,changesDevice=null,nextChanges=null,changesHost='';
  const display=value=>value===null?'—':Array.isArray(value)?value.join(', ') || '—':String(value) || '—';
  async function loadChanges(append=false) {
    const token=++changesVersion,message=$('changes-message'),more=$('changes-more');
    if(!append){$('changes-list').replaceChildren();nextChanges=null;more.hidden=true;}
    message.textContent='Wczytywanie zmian…';more.disabled=true;
    const params=new URLSearchParams();
    if(append && nextChanges)params.set('before',nextChanges);
    if(changesDevice!==null)params.set('deviceId',changesDevice);
    if($('changes-query').value.trim())params.set('q',$('changes-query').value.trim());
    $('changes-scope').textContent=changesDevice!==null?`Maszyna: ${changesHost}`:'Wszystkie maszyny';
    try {
      const result=await api(`/api/device-changes?${params}`);if(token!==changesVersion)return;
      for(const item of result.items) {
        const row=document.createElement('tr');
        for(const text of [new Date(item.recordedAt).toLocaleString('pl-PL'),item.hostName,actions[item.action]||item.action]) {
          const cell=document.createElement('td');cell.textContent=text;row.append(cell);
        }
        const cell=document.createElement('td');
        for(const change of item.changes) {
          const detail=document.createElement('details'),summary=document.createElement('summary');
          summary.textContent=fieldNames[change.field] || change.field;
          const before=document.createElement('p'),after=document.createElement('p');
          before.textContent=`Przed: ${display(change.before)}`;after.textContent=`Po: ${display(change.after)}`;
          detail.append(summary,before,after);cell.append(detail);
        }
        row.append(cell);$('changes-list').append(row);
      }
      nextChanges=result.nextBefore;more.hidden=!nextChanges;
      message.textContent=$('changes-list').children.length?'':'Brak zmian spełniających filtr. Wcześniejsze operacje sprzed wersji 1.4.0 nie są odtwarzane.';
    }catch(error){if(token===changesVersion)message.textContent=error.message;}
    finally{if(token===changesVersion)more.disabled=false;}
  }
  window.showDeviceChanges=(id,host)=>{
    changesDevice=id;changesHost=host;$('changes-query').value='';
    document.querySelector('[data-view="changes-view"]').click();
  };
  document.querySelector('[data-view="changes-view"]').addEventListener('click',()=>loadChanges());
  $('changes-refresh').addEventListener('click',()=>loadChanges());
  $('changes-search').addEventListener('click',()=>loadChanges());
  $('changes-query').addEventListener('keydown',event=>{if(event.key==='Enter')loadChanges();});
  $('changes-clear').addEventListener('click',()=>{changesDevice=null;$('changes-query').value='';loadChanges();});
  $('changes-more').addEventListener('click',()=>loadChanges(true));

  let mapVersion=0,mapDevices=[],requestedFocus='';
  const mapDialog=$('dependency-map-dialog');
  function svgElement(tag,attributes={},text) {
    const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [name,value] of Object.entries(attributes))element.setAttribute(name,String(value));
    if(text!==undefined)element.textContent=text;return element;
  }
  function drawMap() {
    const byId=new Map(mapDevices.map(device=>[device.id,device]));
    const edges=mapDevices.flatMap(device=>device.dependencyIds.filter(id=>byId.has(id)).map(id=>[device.id,id]));
    let visible;
    if($('map-focus').value) {
      const focus=Number($('map-focus').value),seen=new Set(),stack=[focus],neighbors=new Map(mapDevices.map(device=>[device.id,[]]));
      for(const [a,b] of edges){neighbors.get(a).push(b);neighbors.get(b).push(a);}
      while(stack.length){const id=stack.pop();if(seen.has(id))continue;seen.add(id);for(const neighbor of neighbors.get(id)||[])if(!seen.has(neighbor))stack.push(neighbor);}
      visible=mapDevices.filter(device=>seen.has(device.id));
    }else {
      const linked=new Set(edges.flat());visible=linked.size?mapDevices.filter(device=>linked.has(device.id)):mapDevices;
    }
    if($('map-focus').value){const focus=Number($('map-focus').value);visible.sort((a,b)=>Number(b.id===focus)-Number(a.id===focus));}
    const total=visible.length;visible=visible.slice(0,120);
    $('map-message').textContent=total?`Maszyny: ${visible.length} z ${total}.${total>120?' Limit widoku to 120 węzłów; wybierz zakres pojedynczej maszyny.':''}`:'Brak maszyn do wyświetlenia.';
    const container=$('dependency-map');container.replaceChildren();if(!visible.length)return;
    const ids=new Set(visible.map(device=>device.id));
    const neighbors=new Map(visible.map(device=>[device.id,new Set()]));
    for(const [a,b] of edges) if(ids.has(a)&&ids.has(b)){neighbors.get(a).add(b);neighbors.get(b).add(a);}
    const points=new Map(),sections=[];let top=30,width=280;
    for(const device of visible) {
      if(points.has(device.id))continue;
      const component=[],seen=new Set([device.id]),pending=[device.id];
      for(let i=0;i<pending.length;i++){const id=pending[i];component.push(id);for(const next of neighbors.get(id))if(!seen.has(next)){seen.add(next);pending.push(next);}}
      const root=component.includes(Number($('map-focus').value))?Number($('map-focus').value):component.reduce((a,b)=>neighbors.get(b).size>neighbors.get(a).size?b:a);
      const levels=new Map([[root,0]]),queue=[root],rows=new Map();
      for(let i=0;i<queue.length;i++){const id=queue[i],level=levels.get(id);for(const next of neighbors.get(id))if(!levels.has(next)){levels.set(next,level+1);queue.push(next);}}
      for(const id of queue){const level=levels.get(id),row=rows.get(level)||0;points.set(id,{x:30+level*310,y:top+35+row*108});rows.set(level,row+1);width=Math.max(width,level*310+280);}
      sections.push({top,count:component.length});top+=Math.max(...rows.values())*108+85;
    }
    const height=top;
    const svg=svgElement('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':'Mapa zależności maszyn'});
    const defs=svgElement('defs'),marker=svgElement('marker',{id:'map-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
    marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#8993a8'}));defs.append(marker);svg.append(defs);
    sections.forEach((section,index)=>svg.append(svgElement('text',{x:30,y:section.top+10,class:'map-section-title'},`Powiązanie ${index+1} · ${section.count} maszyn`)));
    const emphasize=id=>{
      svg.classList.toggle('map-has-focus',id!==null);
      svg.querySelectorAll('.map-edge').forEach(edge=>edge.classList.toggle('map-edge-active',edge.dataset.from===String(id)||edge.dataset.to===String(id)));
      svg.querySelectorAll('.map-node').forEach(node=>node.classList.toggle('map-node-related',id!==null&&(node.dataset.id===String(id)||neighbors.get(id)?.has(Number(node.dataset.id)))));
    };
    for(const [a,b] of edges) {
      const from=points.get(a),to=points.get(b);if(!from||!to)continue;
      const sameColumn=to.x===from.x,forward=to.x>from.x;
      const x1=from.x+((forward||sameColumn)?220:0),y1=from.y+34,x2=to.x+(forward?0:220),y2=to.y+34;
      svg.append(svgElement('path',{d:`M ${x1} ${y1} C ${x1+((forward||sameColumn)?45:-45)} ${y1},${x2+(forward?-45:45)} ${y2},${x2} ${y2}`,class:'map-edge','data-from':a,'data-to':b,'marker-end':'url(#map-arrow)'}));
    }
    for(const device of visible) {
      const point=points.get(device.id),node=svgElement('g',{class:`map-node map-node-${device.status}`,transform:`translate(${point.x},${point.y})`,'data-id':device.id,role:'button',tabindex:0,'aria-label':`Szczegóły: ${device.hostName}`});
      node.append(svgElement('rect',{width:220,height:68,rx:9}));
      node.append(svgElement('circle',{cx:14,cy:20,r:4}));
      const title=device.hostName.length>24?device.hostName.slice(0,23)+'…':device.hostName;
      node.append(svgElement('text',{x:27,y:24,class:'map-host'},title));
      node.append(svgElement('text',{x:14,y:47,class:'map-meta'},device.ip || device.location));
      node.append(svgElement('title',{},`${device.hostName} · ${device.category} · ${device.status}`));
      const open=()=>{mapDialog.close();openDeviceDetails(device);};
      node.addEventListener('mouseenter',()=>emphasize(device.id));node.addEventListener('mouseleave',()=>emphasize(null));node.addEventListener('focus',()=>emphasize(device.id));node.addEventListener('blur',()=>emphasize(null));
      node.addEventListener('click',open);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
      svg.append(node);
    }
    svg.style.width=`${width*Number($('map-zoom').value)/100}px`;container.append(svg);
  }
  async function loadMap() {
    const token=++mapVersion;$('map-message').textContent='Wczytywanie zależności…';
    try {
      const result=await api('/api/devices');if(token!==mapVersion)return;mapDevices=result;
      const select=$('map-focus');select.replaceChildren(new Option('Wszystkie powiązane maszyny',''));
      for(const device of mapDevices)select.add(new Option(device.hostName,String(device.id)));
      select.value=mapDevices.some(device=>String(device.id)===requestedFocus)?requestedFocus:'';
      drawMap();
    }catch(error){if(token===mapVersion)$('map-message').textContent=error.message;}
  }
  window.openDependencyGraph=id=>{requestedFocus=id===undefined?'':String(id);$('map-zoom').value='100';if(!mapDialog.open)mapDialog.showModal();loadMap();};
  $('inventory-graph').addEventListener('click',()=>window.openDependencyGraph());
  $('map-focus').addEventListener('change',()=>{requestedFocus=$('map-focus').value;drawMap();});
  $('map-zoom').addEventListener('input',drawMap);$('map-refresh').addEventListener('click',loadMap);
  mapDialog.addEventListener('close',()=>{if(!mapDialog.open)mapVersion++;});
})();
