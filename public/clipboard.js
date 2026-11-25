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
