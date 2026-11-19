// The PNG stays flat. Only the copy displayed on the ticket desk is transformed.
export function enableTicketTilt(surface) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let pointer = null;
  let startX = 0, startY = 0;
  let pitch = 0, yaw = 0;
  const clamp = x => Math.max(-1, Math.min(1,x));
  function tilt(horizontal,vertical) {
    yaw = clamp(horizontal);
    pitch = clamp(vertical);
    surface.style.setProperty('--yaw', (yaw * 7).toFixed(2)+'deg');
    surface.style.setProperty('--pitch', (-pitch * 5).toFixed(2)+'deg');
    surface.style.setProperty('--dx',(yaw * 2.5).toFixed(2)+'px');
    surface.style.setProperty('--dy',(pitch * 1.5).toFixed(2)+'px');
  }
  function reset() {
    pointer = null;
    surface.classList.remove('held');
    tilt(0,0);
  }
  surface.onpointerdown = e => {
    if (reduce.matches || pointer !== null || e.button !== 0) return;
    pointer = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    surface.setPointerCapture(pointer);
    surface.classList.add('held');
  };
  surface.onpointermove = e => {
    if (pointer !== e.pointerId) return;
    tilt((e.clientX-startX)/65, (e.clientY-startY)/48);
  };
  surface.onpointerup = surface.onpointercancel = surface.onlostpointercapture = e => {
    if (pointer === e.pointerId) reset();
  };
  surface.onkeydown = e => {
    if (reduce.matches || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    surface.classList.add('held');
    tilt(yaw + (e.key==='ArrowRight'?.4:e.key==='ArrowLeft'?-.4:0),
         pitch + (e.key==='ArrowDown'?.4:e.key==='ArrowUp'?-.4:0));
  };
  surface.onkeyup = e => { if (e.key.startsWith('Arrow')) reset(); };
  surface.onblur = reset;
}
