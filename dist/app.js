import { openImport } from './import.js?v=4';

const $ = s => document.querySelector(s);
const icons = {
 sliders:'<path d="M4 7h6m5 0h5M4 17h10m4 0h2"/><circle cx="12.5" cy="7" r="2.5"/><circle cx="16" cy="17" r="2.5"/>',
 user:'<circle cx="12" cy="8" r="3.4"/><path d="M5 20v-2a7 7 0 0 1 14 0v2z"/>',
 disc:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M6 12a6 6 0 0 1 6-6"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
 scan:'<path d="M9 3H4v5m11-5h5v5M4 16v5h5m6 0h5v-5M2 12h20"/>',
 image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.3"/><path d="m4 17 5-5 4 4 3-4 4 5"/>',
 receipt:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8m-8 4h6"/>',
 share:'<path d="M4 14v6h16v-6m-8 1V3m-5 5 5-5 5 5"/>',
 versus:'<path d="m3 3 4 1 12 13-2 2L4 7zm18 0-4 1-5 6m-2 3-5 4 2 2 5-5m3 6 5-5m-16 0 5 5"/>',
 close:'<path d="m5 5 14 14m0-14L5 19"/>'
};
document.querySelectorAll('[data-icon]').forEach(el=>{
 el.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+icons[el.dataset.icon]+'</svg>';
});
const pools={agent:'限定代理人',engine:'限定音擎'};
const number=v=>Number(v.toFixed(2)).toString();
const score=v=>v.toFixed(1);
const tier=v=>v>=97?'欧皇驾到':v>=75?'欧气上扬':v>=55?'手气不错':v>=45?'信号平稳':v>=25?'欧气蓄力':v>=3?'逆风调频':'保底常客';
let pool='agent', active=null, mode='demo', requestId=0;
const dialog=$('#dialog'), contents=$('#dialog-content');
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function writeStored(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
function showDialog(title,html,isTicket=false){dialog.classList.toggle('ticket-dialog',isTicket);$('#dialog-title').textContent=title;contents.innerHTML=html;if(!dialog.open)dialog.showModal()}
$('#close').onclick=()=>dialog.close();
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
function choosePool(p){if(!(p in pools))return;pool=p;$('#avg').max=p==='agent'?180:160;document.querySelectorAll('[data-pool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pool===p)))}
document.querySelectorAll('[data-pool]').forEach(b=>b.onclick=()=>choosePool(b.dataset.pool));
function binDescription(bin) {
  const chance = bin.probability > 0 && bin.probability < .0001 ? '<0.01' : number(bin.probability * 100);
  return (bin.tail ? '尾部合并 · ' : '') + number(bin.low) + '–' + number(bin.high) + ' 抽/UP，占 ' + chance + '%';
}

function ticketScale() {
  const cssWidth = Math.min(850, document.documentElement.clientWidth - 24) - 6
    - 2 * Math.max(8, Math.min(28, window.innerWidth * .025));
  return cssWidth * window.devicePixelRatio > 1160 ? 2 : 1;
}
let ticketModules;
function loadTicketModules() {
  return ticketModules ??= Promise.all([import('./ticket.js?v=2'), import('./ticket-preview.js')]);
}
function prepareTicket(result) {
  async function render() {
    if (active !== result || document.hidden) return;
    try {
      const [{ getTicket }] = await loadTicketModules();
      if (active !== result || document.hidden) return;
      await getTicket(result, tier(result.percentile), false, ticketScale(), sharedUrl(result)).preview;
    } catch {}
  }
  if (window.requestIdleCallback) window.requestIdleCallback(render, { timeout: 600 });
  else setTimeout(render, 0);
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let chartObserver;
function growBar(bar, delay = 0) {
  if (reducedMotion.matches || !bar.animate) return;
  for (const previous of bar.getAnimations()) previous.cancel();
  bar.animate([
    { transform: 'scaleY(0)' },
    { transform: 'scaleY(1.045)', offset: .8 },
    { transform: 'scaleY(1)' }
  ], { duration: 490, delay, easing: 'cubic-bezier(.22,.72,.28,1)', fill: 'backwards' });
}

function chart(result) {
  const plot = $('#chart');
  chartObserver?.disconnect();
  plot.replaceChildren();
  plot.classList.remove('inspecting');
  const max = Math.max(...result.bins.map(bin => bin.probability));
  const currentBin = result.bins.find(bin => bin.current);
  let touchPointer = null, inspected = null;
  function display(bin) {
    $('#bininfo').textContent = (bin.current ? '你的区间 · ' : '所选区间 · ') + binDescription(bin);
  }
  function clearInspection() {
    inspected?.classList.remove('inspected');
    inspected = null;
    plot.classList.remove('inspecting');
  }
  function scrub(event) {
    if (event.pointerId !== touchPointer) return;
    const { left, width } = plot.getBoundingClientRect();
    const offset = Math.floor((event.clientX - left) / width * result.bins.length);
    const index = Math.min(result.bins.length - 1, Math.max(0, offset));
    const button = plot.children[index];
    if (!button || button === inspected) return;
    inspected?.classList.remove('inspected');
    inspected = button;
    inspected.classList.add('inspected');
    const bin = result.bins[index];
    plot.classList.toggle('inspecting', !bin.current);
    display(bin);
  }
  plot.onpointerdown = event => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    touchPointer = event.pointerId;
    plot.setPointerCapture(touchPointer);
    chartObserver?.disconnect();
    plot.classList.remove('waiting');
    scrub(event);
  };
  plot.onpointermove = scrub;
  plot.onpointerup = event => {
    if (event.pointerId !== touchPointer) return;
    scrub(event);
    touchPointer = null;
  };
  plot.onpointercancel = plot.onlostpointercapture = event => {
    if (event.pointerId !== touchPointer) return;
    touchPointer = null;
    clearInspection();
    display(currentBin);
  };
  for (const bin of result.bins) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('current', bin.current);
    button.classList.toggle('tail', bin.tail);
    button.setAttribute('aria-label', (bin.current ? '你的落点，' : '') + binDescription(bin));
    const bar = document.createElement('span');
    bar.style.height = bin.probability / max * 100 + '%';
    button.append(bar);
    for (const event of ['pointerenter', 'focus']) button.addEventListener(event, e => {
      if (touchPointer !== null || e.pointerType === 'touch') return;
      clearInspection();
      display(bin);
    });
    button.addEventListener('click', () => {
      display(bin);
      growBar(bar);
    });
    plot.append(button);
  }
  display(currentBin);
  const first = result.bins[0], last = result.bins[result.bins.length - 1];
  $('#minaxis').textContent = first.tail ? '≤ ' + number(first.high) + ' 抽' : number(first.low) + ' 抽';
  $('#maxaxis').textContent = last.tail ? '≥ ' + number(last.low) + ' 抽' : number(last.high) + ' 抽';

  plot.classList.remove('waiting');
  if (!reducedMotion.matches && 'IntersectionObserver' in window && plot.animate) {
    plot.classList.add('waiting');
    const observer = new IntersectionObserver(entries => {
      if (chartObserver !== observer || !entries.some(entry => entry.intersectionRatio >= .55)) return;
      observer.disconnect();
      plot.classList.remove('waiting');
      plot.querySelectorAll('button span').forEach((bar, index) => growBar(bar, index * 13));
    }, { threshold: .55 });
    chartObserver = observer;
    observer.observe(plot);
  }
}
function setForm(r){choosePool(r.pool);$('#count').value=r.count;$('#avg').value=r.enteredAverage??r.average}
async function calculate(p,c,a,kind='self',jump=false,submitSample=false){
 const id=++requestId;$('#err').hidden=true;$('#run').disabled=true;
 const feedback=setTimeout(()=>{if(id===requestId)$('#run-label').textContent='正在鉴定…'},160);
 try{const r=await LuckModel.analyze(p,c,a);if(id!==requestId)return;active=r;mode=kind;
 $('#score').innerHTML=score(r.percentile)+'<small>%</small>';$('#sample-badge').hidden=kind==='demo';$('#sample-badge').textContent=kind==='friend'?'好友鉴定票':kind==='self'?'鉴定完成':'';
 $('#tier').textContent=tier(r.percentile);$('#summary').textContent=pools[r.pool]+' · '+r.count+' 个 UP · 平均 '+number(r.average)+' 抽';chart(r);
 showSampleSubmission(r,submitSample);
 if(kind!=='demo')prepareTicket(r);
 if(jump&&matchMedia('(max-width:680px)').matches)document.querySelector('.report').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'start'})
 }catch(e){if(id!==requestId)return;$('#err').textContent=e.message;$('#err').hidden=false;if(!active)$('#tier').textContent='暂未出具'}
 finally{clearTimeout(feedback);if(id===requestId){$('#run-label').textContent='开始鉴定';$('#run').disabled=false}}
}
$('#entry').onsubmit=e=>{e.preventDefault();calculate(pool,$('#count').valueAsNumber,$('#avg').valueAsNumber,'self',true)};
$('#import').onclick=()=>openImport(pool,r=>{
  setForm({pool:r.pool,count:r.count,average:r.avg});
  calculate(r.pool,r.count,r.avg,'self',true,r.submitSample);
},sampleIsAvailable());

async function sampleIsAvailable() {
  try {
    const response=await fetch('./api/sample');
    return response.ok&&(await response.json()).available===true;
  } catch {
    return false;
  }
}

function showSampleSubmission(result,shouldSubmit) {
  const output=$('#sample-rank');
  output.hidden=!shouldSubmit;
  output.replaceChildren();
  if(!shouldSubmit)return;

  async function submit() {
    output.textContent='正在提交样本…';
    try {
      let device=readStored('signal.device',null);
      if(!device){
        device=crypto.randomUUID();
        if(!writeStored('signal.device',device))throw Error();
      }
      const {pool,count,total}=result;
      const response=await fetch('./api/sample',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pool,count,total,device})
      });
      if(!response.ok)throw Error();
      if(active!==result)return;
      output.textContent='匿名提交成功。';
    } catch {
      if(active!==result)return;
      const retry=document.createElement('button');
      retry.type='button';
      retry.textContent='提交失败，点此重试';
      retry.onclick=submit;
      output.replaceChildren(retry);
    }
  }
  submit();
}
function rules(){showDialog('概率模型说明','<h3>同样拿到这些 UP，你有多欧？</h3><p>把你和同卡池、同 UP 数量的理论记录比较。用抽更少，欧气百分位更高。若显示 80%，约八成记录花了更多抽，并列记录各计一半。</p><h3>从零垫抽、无大保底开始</h3><p>只统计常规限定频道，截止最后一个限定 UP。每次拿到非当期 S 级后，下一个 S 级必为当期 UP。代理人基础 S 率 0.6%，当期概率 50%，90 抽硬保底。音擎分别为 1%、75% 和 80 抽。</p><h3>软保底采用社区模型</h3><p>代理人从第 74 抽、音擎从第 65 抽起，每抽增加 6 个百分点。软保底曲线是社区估计，具体差异会影响百分位。</p><p>1–100 个 UP 使用预计算概率表，101–100,000 个 UP 在本机按需计算离散卷积。浏览器会缓存近期使用的概率表，同池同 UP 数可直接复用。平均抽数乘以 UP 数后取最近整数还原总抽数，截图均值的舍入可能使结果略有变化。</p><p class="muted"><a href="'+LuckModel.source+'" target="_blank" rel="noopener">查看社区调频模型 ↗</a></p>')}
$('#footer-rules').onclick=rules;
function sharedUrl(result) {
  const url = new URL(location.pathname, location.origin);
  const channel = result.pool === 'agent' ? 'A' : 'E';
  url.hash = channel + result.count.toString(36).toUpperCase() + '.' + result.total.toString(36).toUpperCase();
  return url.href;
}
$('#share').onclick = async () => {
  if (!active) return;
  const result = active, demo = mode === 'demo', url = sharedUrl(result);
  showDialog('调频车票', `
    <div class="ticket-stage">
      <div class="ticket-surface" role="group" aria-label="调频车票" aria-describedby="tilt-hint" aria-busy="true">
        <div class="ticket-loading" aria-hidden="true"></div>
      </div>
      <span class="tilt-hint" id="tilt-hint" role="status">正在出票…</span>
    </div>
    <div class="ticket-controls"><div class="modal-buttons">
      <button class="modal-action" type="button" id="save-ticket" disabled>保存车票 PNG</button>
      <button class="modal-action" type="button" id="copy">复制结果链接</button>
    </div></div>`, true);
  const surface = contents.querySelector('.ticket-surface');
  const hint = contents.querySelector('.tilt-hint');
  const save = contents.querySelector('#save-ticket');
  $('#copy').onclick = async e => {
    const button = e.currentTarget;
    try { await navigator.clipboard.writeText(url); button.textContent = '已复制'; }
    catch {
      let field = contents.querySelector('.copy-field');
      if (!field) {
        field = document.createElement('input');
        field.value = url; field.readOnly = true; field.className = 'copy-field';
        contents.querySelector('.ticket-controls').append(field);
      }
      field.select();
    }
  };
  try {
    const [{ getTicket }, { enableTicketTilt }] = await loadTicketModules();
    if (!dialog.open || !surface.isConnected) return;
    const ticket = getTicket(result,tier(result.percentile),demo,ticketScale(),url);
    const picture = await ticket.preview;
    if (!dialog.open || !surface.isConnected) return;
    picture.className = 'ticket-paper';
    picture.setAttribute('role','img');
    picture.setAttribute('aria-label',pools[result.pool]+'调频车票，'+result.count+' 个 UP，欧气百分位 '+score(result.percentile)+'%');
    surface.replaceChildren(picture);
    surface.setAttribute('aria-busy', 'false');
    surface.setAttribute('aria-label', '调频车票，可轻拨票面或使用方向键');
    surface.tabIndex = 0;
    enableTicketTilt(surface);
    hint.textContent = reducedMotion.matches ? '' : '按住票面轻拨，松手回正';
    save.disabled = false;
    save.onclick = async () => {
      save.disabled = true;
      save.textContent = '正在导出…';
      try {
        const blob = await ticket.exportPng();
        if (!dialog.open || !save.isConnected) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = '新艾利都-调频车票.png';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href),60000);
      } catch {
        hint.textContent = '图片导出失败，请再试一次。';
      } finally {
        save.disabled = false;
        save.textContent = '保存车票 PNG';
      }
    };
  } catch {
    if (!dialog.open || !surface.isConnected) return;
    surface.replaceChildren();
    surface.setAttribute('aria-busy', 'false');
    hint.textContent = '票面未能生成，请关闭后重试。';
  }
};
$('#pk').onclick=()=>{if(!active)return;const a=active;showDialog('好友 PK','<p>以'+(mode==='friend'?'好友鉴定票':'当前鉴定票')+'的 <strong>'+score(a.percentile)+'%</strong> 迎战。双方分别按自己的卡池和 UP 数量计算理论百分位。</p><form class="pkform"><label>对手频道<select id="p-pool"><option value="agent">限定代理人</option><option value="engine">限定音擎</option></select></label><label>限定 UP 数量<input required id="p-count" type="number" min="1" max="100000" value="'+a.count+'"></label><label>平均每 UP 抽数<input required id="p-avg" type="number" step="any" min="1" placeholder="输入对手的数据"></label><button>对比欧气</button></form><p class="pkresult" hidden role="status"></p>');$('#p-pool').value=a.pool;const limit=()=>$('#p-avg').max=LuckModel.maxAverage[$('#p-pool').value];limit();$('#p-pool').onchange=limit;
 let comparison=0;
 $('.pkform').onsubmit=async e=>{
   e.preventDefault();
   const id=++comparison, box=$('.pkresult');
   box.hidden=false;
   box.textContent='正在对比欧气…';
   try{
     const b=await LuckModel.analyze($('#p-pool').value,$('#p-count').valueAsNumber,$('#p-avg').valueAsNumber);
     if(id!==comparison)return;
     const d=+(score(a.percentile)-score(b.percentile)).toFixed(1);
     box.textContent='当前票 '+score(a.percentile)+'%  /  对手 '+score(b.percentile)+'% · '+(d===0?'按展示精度打成平手。':(d>0?'当前票':'对手')+'领先 '+number(Math.abs(d))+' 个百分点。');
   }catch(e){if(id===comparison)box.textContent=e.message}
 };
};
function readTicket(hash) {
  const compact = /^#([AE])([0-9A-Z]{1,4})\.([0-9A-Z]{1,5})$/i.exec(hash);
  if (compact) return {
    pool: compact[1].toUpperCase() === 'A' ? 'agent' : 'engine',
    count: parseInt(compact[2],36), total: parseInt(compact[3],36)
  };
  const legacy = /^#ticket=(agent|engine)\.(\d{1,6})\.(\d{1,8})$/.exec(hash);
  if (legacy) return {pool:legacy[1], count:Number(legacy[2]), total:Number(legacy[3])};
}
function boot() {
  const ticket = readTicket(location.hash);
  if (ticket) {
    const {pool,count,total} = ticket;
    if (count >= 1 && count <= LuckModel.maxCount && total >= count && total <= count * LuckModel.maxAverage[pool]) {
      const avg = total / count;
      setForm({pool,count,average:avg});
      return calculate(pool,count,avg,'friend');
    }
  }
  return calculate('agent',5,75,'demo');
}
window.addEventListener('hashchange', boot);
boot();
