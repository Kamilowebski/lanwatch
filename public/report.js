function summarizeReport(items) {
  const counts = {online:0,offline:0,unknown:0};
  for (const item of items) counts[item.status in counts ? item.status : 'unknown']++;
  const latencies = items.filter(item => item.status === 'online' && Number.isFinite(item.latencyMs)).map(item => item.latencyMs);
  return {counts,total:items.length,averageMs:latencies.length ? latencies.reduce((a,b)=>a+b,0)/latencies.length : null,
    percentages:Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,items.length ? value/items.length*100 : 0]))};
}
if (typeof module !== 'undefined' && module.exports) module.exports = {summarizeReport};
if (typeof window !== 'undefined') (() => {
  let currentDevice, version=0;
  const dialog=document.getElementById('monitor-report-dialog');
  const range=document.getElementById('report-range');
  const message=document.getElementById('report-message');
  const content=document.getElementById('report-content');
  const labels={online:'Online',offline:'Brak odpowiedzi',unknown:'Nieustalony'};
  const colors={online:'#37a875',offline:'#d65b57',unknown:'#9a91d7'};
  const number=value=>new Intl.NumberFormat('pl-PL',{maximumFractionDigits:1}).format(value);
  function svgElement(tag,attributes={},text) {
    const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
    if(text!==undefined)element.textContent=text;
    return element;
  }
  function draw(items) {
    const container=document.getElementById('report-chart');container.replaceChildren();
    const svg=svgElement('svg',{viewBox:'0 0 860 210',role:'img','aria-label':'Wyniki sprawdzeń w czasie: online, brak odpowiedzi i status nieustalony'});
    const times=items.map(item=>Date.parse(item.checkedAt));
    const start=Math.min(...times),end=Math.max(...times);
    const x=time=>end===start ? 475 : 135+(time-start)/(end-start)*680;
    const y={online:40,offline:92,unknown:144};
    for(const key of Object.keys(y)) {
      svg.append(svgElement('line',{x1:135,x2:815,y1:y[key],y2:y[key],class:'report-grid'}));
      svg.append(svgElement('text',{x:8,y:y[key]+4,fill:colors[key]},labels[key]));
    }
    for(const item of items) {
      const status=item.status in y ? item.status : 'unknown';
      const dot=svgElement('circle',{cx:x(Date.parse(item.checkedAt)),cy:y[status],r:items.length>300?2.5:4.5,fill:colors[status]});
      dot.append(svgElement('title',{},`${new Date(item.checkedAt).toLocaleString('pl-PL')} · ${labels[status]}${item.latencyMs==null?'':` · ${number(item.latencyMs)} ms`}`));
      svg.append(dot);
    }
    for(const [time,anchor] of start===end ? [[start,'middle']] : [[start,'start'],[end,'end']]) {
      svg.append(svgElement('text',{x:x(time),y:185,'text-anchor':anchor,class:'report-axis'},new Date(time).toLocaleString('pl-PL')));
    }
    container.append(svg);
  }
  async function load() {
    if(!currentDevice)return;
    const token=++version;
    message.textContent='Wczytywanie raportu…';message.hidden=false;content.hidden=true;
    try {
      const {items}=await api(`/api/devices/${currentDevice.id}/report?hours=${range.value}`);
      if(token!==version)return;
      if(!items.length){message.textContent='Brak sprawdzeń w wybranym zakresie. Wybierz dłuższy okres lub uruchom monitoring.';return;}
      const summary=summarizeReport(items),stats=document.getElementById('report-stats');stats.replaceChildren();
      for(const key of Object.keys(labels)) {
        const card=document.createElement('article');card.className=`report-stat report-stat-${key}`;
        const title=document.createElement('span');title.textContent=labels[key];
        const value=document.createElement('strong');value.textContent=`${number(summary.percentages[key])}%`;
        const detail=document.createElement('small');detail.textContent=`${summary.counts[key]} z ${summary.total} sprawdzeń`;
        card.append(title,value,detail);stats.append(card);
      }
      const card=document.createElement('article');card.className='report-stat';
      const title=document.createElement('span');title.textContent='Średnie opóźnienie';
      const value=document.createElement('strong');value.textContent=summary.averageMs===null?'—':`${number(summary.averageMs)} ms`;
      const detail=document.createElement('small');detail.textContent='Z poprawnych pomiarów Online';card.append(title,value,detail);stats.append(card);
      draw(items);
      document.getElementById('report-coverage').textContent=`Procenty dotyczą liczby zapisanych sprawdzeń, nie procentu czasu działania. Status nieustalony wlicza się do wszystkich prób. Historia zachowuje do 1000 ostatnich wyników na maszynę; luki i starsze usunięte wyniki nie są odtwarzane.`;
      message.hidden=true;content.hidden=false;
    }catch(error){if(token===version)message.textContent=error.message;}
  }
  range.addEventListener('change',load);
  document.getElementById('report-refresh').addEventListener('click',load);
  dialog.addEventListener('close',()=>version++);
  window.openMonitorReport=device=>{
    currentDevice=device;document.getElementById('monitor-report-title').textContent=device.hostName;
    if(!dialog.open)dialog.showModal();load();
  };
})();
