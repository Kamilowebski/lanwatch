const defaults = Object.freeze({intervalSeconds:60,attempts:3,concurrency:8,failureThreshold:3,paused:false,pausedGroups:[]});
function validate(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(key=>!Object.hasOwn(defaults,key))) throw Object.assign(new Error('Nieprawidłowe ustawienia monitora.'),{status:400});
  const value={...defaults,...settings};
  for(const [key,min,max] of [['intervalSeconds',15,3600],['attempts',1,5],['concurrency',1,16],['failureThreshold',1,10]]) if(!Number.isInteger(value[key])||value[key]<min||value[key]>max) throw Object.assign(new Error(`Nieprawidłowe ustawienie: ${key} (${min}–${max}).`),{status:400});
  if(typeof value.paused!=='boolean'||!Array.isArray(value.pausedGroups)||value.pausedGroups.length>500||value.pausedGroups.some(name=>typeof name!=='string'||name.length>100))throw Object.assign(new Error('Nieprawidłowe ustawienia pauzy.'),{status:400});
  value.pausedGroups=[...new Set(value.pausedGroups.map(name=>name.trim().toLocaleLowerCase('pl')))];return value;
}
function isPaused(device, settings) {return settings.paused || settings.pausedGroups.includes((device.groupName||'').trim().toLocaleLowerCase('pl'));}
function createMonitorStore(database) {
  let cached;
  const read=()=>{if(!cached){try{cached=validate(JSON.parse(database.prepare("SELECT value FROM app_settings WHERE key='monitor_settings'").get()?.value||'{}'));}catch{cached=validate({});}}return {...cached,pausedGroups:[...cached.pausedGroups]};};
  return {get:read,set:settings=>{const next=validate(settings);database.prepare("INSERT INTO app_settings(key,value) VALUES('monitor_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));cached=next;return read();}};
}
module.exports={defaults,validate,isPaused,createMonitorStore};
