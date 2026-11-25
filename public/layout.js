(() => {
  const view=document.getElementById('settings-view');
  const nav=view.querySelector('.settings-section-nav'),grid=view.querySelector('.settings-grid');
  const cards=[...grid.querySelectorAll(':scope > .settings-card')];
  const layout=document.createElement('div');layout.className='settings-workspace';
  nav.before(layout);layout.append(nav,grid);
  function select(id,focus=false){
    const card=cards.find(item=>item.id===id);if(!card)return;
    cards.forEach(item=>{item.hidden=item!==card;});
    nav.querySelectorAll('a').forEach(link=>{
      if(link.hash===`#${id}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
    savePreference('lanwatch-settings-section',id);
    if(focus){const heading=card.querySelector('h2');heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }
  nav.addEventListener('click',event=>{
    const link=event.target.closest('a');if(!link)return;
    event.preventDefault();select(link.hash.slice(1),true);
    history.replaceState(null,'',link.hash);
  });
  function openLinkedSection(){
    const id=location.hash.slice(1);
    if(!cards.some(card=>card.id===id))return;
    select(id);
    if(view.classList.contains('d-none'))document.querySelector('[data-view="settings-view"]').click();
  }
  window.addEventListener('hashchange',openLinkedSection);
  const requested=location.hash.slice(1)||readPreference('lanwatch-settings-section');
  select(cards.some(card=>card.id===requested)?requested:'settings-monitor');
  openLinkedSection();
})();
