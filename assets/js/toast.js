/* Notifications toast partagées. Attend un <div id="toast-container"> dans la page. */
export function toast(msg, type='info'){
  const c = { success:'#1fae7c', error:'#c9282f', warn:'#c9a227', info:'#c9a227' };
  const i = { success:'✓', error:'✗', warn:'⚠', info:'◆' };
  let container = document.getElementById('toast-container');
  if(!container){
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--tc', c[type] || c.info);
  el.innerHTML = `<span>${i[type] || '◆'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(()=>{ el.classList.add('removing'); setTimeout(()=>el.remove(), 300); }, 3500);
}
