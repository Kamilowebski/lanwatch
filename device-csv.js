const COLUMNS = ['hostName','ip','groupName','location','category','description','lineNumber','numerator','dependencyHosts','_format'];
function csvError(message) { return Object.assign(new Error(message),{status:400}); }
function records(text, separator) {
  const result=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) {
      if(c==='"') {if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
      else cell+=c;
      continue;
    }
    if(c==='"') {if(cell || closed)throw csvError('Nieprawidłowy cudzysłów w CSV.');quoted=true;}
    else if(c===separator) {row.push(cell);cell='';closed=false;}
    else if(c==='\r'||c==='\n') {
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);if(row.some(value=>value!==''))result.push(row);row=[];cell='';closed=false;
    } else {if(closed)throw csvError('Niedozwolony tekst po zamknięciu cudzysłowu w CSV.');cell+=c;}
  }
  if(quoted)throw csvError('Niezamknięty cudzysłów w CSV.');
  row.push(cell);if(row.some(value=>value!==''))result.push(row);
  return result;
}
function parseDeviceCsv(text) {
  if(typeof text!=='string' || Buffer.byteLength(text,'utf8')>900000)throw csvError('CSV musi być tekstem do 900 KB.');
  text=text.replace(/^\uFEFF/,'');
  let data;
  for(const separator of [';',',']) {
    try { const parsed=records(text,separator);if(parsed[0]?.map(x=>x.trim().toLowerCase()).includes('hostname')){data=parsed;break;} }
    catch(error){if(separator===',')throw error;}
  }
  if(!data?.length)throw csvError('Brak nagłówka hostName. Użyj pliku wyeksportowanego z Lanwatch.');
  const canonical=new Map(COLUMNS.map(key=>[key.toLowerCase(),key]));
  const headers=data.shift().map(value=>canonical.get(value.trim().toLowerCase()));
  if(headers.some(key=>!key) || new Set(headers).size!==headers.length)throw csvError('Nieznane lub powtórzone kolumny CSV.');
  if(!['hostName','location','category'].every(key=>headers.includes(key)))throw csvError('Wymagane kolumny: hostName, location, category.');
  if(!data.length || data.length>500)throw csvError('Import wymaga od 1 do 500 maszyn.');
  return data.map((cells,index)=>{
    if(cells.length!==headers.length)throw csvError(`Wiersz ${index+2}: liczba pól różni się od nagłówka.`);
    const input=Object.fromEntries(headers.map((key,i)=>[key,cells[i]]));
    // Decode spreadsheet protection only for our explicitly marked export format.
    if(input._format==='lanwatch-csv-v1')for(const key of headers)if(key!=='_format' && input[key].startsWith("'"))input[key]=input[key].slice(1);
    let dependencyHosts=[];
    try {dependencyHosts=input.dependencyHosts?JSON.parse(input.dependencyHosts):[];}catch{throw csvError(`Wiersz ${index+2}: dependencyHosts musi być tablicą JSON nazw hostów.`);}
    if(!Array.isArray(dependencyHosts)||dependencyHosts.some(value=>typeof value!=='string'||!value.trim()||value.length>255))throw csvError(`Wiersz ${index+2}: nieprawidłowe nazwy zależności.`);
    const row={};for(const key of COLUMNS)if(!['dependencyHosts','_format'].includes(key))row[key]=input[key]??'';
    return {...row,dependencyHosts:dependencyHosts.map(value=>value.trim()),csvRow:index+2};
  });
}
function exportDeviceCsv(devices) {
  const quote=value=>{
    let text=String(value??'');
    if(/^[=+\-@\t\r\n']/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  const lines=[COLUMNS.map(quote).join(';')];
  for(const device of devices)lines.push(COLUMNS.map(key=>quote(key==='_format'?'lanwatch-csv-v1':key==='dependencyHosts'?JSON.stringify(device.dependencies || []):device[key])).join(';'));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
module.exports={parseDeviceCsv,exportDeviceCsv};
