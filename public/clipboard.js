async function copyPlainText(text, control) {
  const value=String(text);
  try {
    if(!navigator.clipboard?.writeText)throw Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(value);
  } catch {
    const area=document.createElement('textarea');area.value=value;area.className='clipboard-buffer';area.readOnly=true;
    const parent=[...document.querySelectorAll('dialog[open]')].pop() || document.body;
    parent.append(area);area.select();
    try {if(!document.execCommand('copy'))throw Error('Przeglądarka odmówiła kopiowania. Zaznacz tekst i użyj Ctrl+C.');}
    finally {area.remove();if(control?.isConnected)control.focus({preventScroll:true});}
  }
}
function makeCopyButton(value, label) {
  const button=document.createElement('button');button.type='button';button.className='copy-value-button';button.textContent='Kopiuj';
  button.setAttribute('aria-label',label);button.disabled=!value;
  if(!value)button.title='Brak zapisanego adresu IP';
  button.addEventListener('click',async()=>{
    if(button.disabled)return;
    button.disabled=true;
    try {await copyPlainText(value,button);button.textContent='Skopiowano';}
    catch(error){notify(error.message,'danger');}
    finally{button.disabled=false;setTimeout(()=>{if(button.isConnected)button.textContent='Kopiuj';},1800);}
  });
  return button;
}
function makeDeviceAddress(device) {
  const line=document.createElement('div');line.className='device-address-line';
  if(!device.ip)return line;
  const button=document.createElement('button');button.type='button';button.className='device-ip-copy';
  button.textContent=device.ip;button.title='Kliknij, aby skopiować adres IP';
  const label=`Kopiuj IP ${device.ip}: ${device.hostName}`;button.setAttribute('aria-label',label);
  const feedback=document.createElement('span');feedback.className='visually-hidden';feedback.setAttribute('role','status');
  button.addEventListener('click',async event=>{
    event.stopPropagation();if(button.disabled)return;button.disabled=true;
    try{await copyPlainText(device.ip,button);button.dataset.copied='true';feedback.textContent=`Skopiowano ${device.ip}`;button.title='Adres IP skopiowany';}
    catch(error){notify(error.message,'danger');}
    finally{button.disabled=false;setTimeout(()=>{if(button.isConnected){delete button.dataset.copied;button.title='Kliknij, aby skopiować adres IP';feedback.textContent='';}},1800);}
  });
  line.append(button,feedback);return line;
}
