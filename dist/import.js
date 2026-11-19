const asset = path => new URL(path, import.meta.url).href;
const limits = {agent:180,engine:160};
let activeDialog;

async function startOcr() {
  const [{ default: T }, { scanScreenshot }] = await Promise.all([
    import(asset('./ocr/tesseract.esm.js')), import('./screenshot-scan.js?v=2')
  ]);
  const worker = await T.createWorker('chi_sim', 1, {
    workerPath: asset('./ocr/mirror-worker.js'),
    workerBlobURL: false,
    langPath: asset('./ocr/'),
    corePath: asset('./ocr/tesseract-core-lstm.wasm.js'),
    cachePath: 'signal-lab-ocr-v1',
    cacheMethod: 'write',
    errorHandler: () => {}
  });
  return { worker, scanScreenshot };
}

export function openImport(initialPool='agent',callback=()=>{},sampleAvailability) {
  activeDialog?.close();
  const dialog=document.createElement('dialog');
  dialog.className='sg-import';
  dialog.setAttribute('aria-labelledby','sg-import-title');
  dialog.innerHTML=`
  <header><div><small>SCREENSHOT READER</small><h2 id="sg-import-title">导入调频截图</h2></div><button type="button" data-close aria-label="关闭">×</button></header>
  <form><div class="sg-grid"><section>
    <label class="sg-upload" tabindex="0" role="button"><input type="file" accept="image/png,image/jpeg,image/webp,image/avif"><strong>选择调频统计截图</strong><span>也可将整张截图拖到这里</span></label>
    <div class="sg-preview" hidden><div class="sg-view"><img alt="导入的调频截图"></div></div>
    <div class="sg-imgtools" hidden><button type="button" data-replace>更换截图</button><button type="button" data-zoom>放大查看</button></div>
  </section><section class="sg-fields">
    <p class="sg-status" role="status">选择截图后会在本机自动读取，核对结果即可鉴定。</p>
    <fieldset hidden disabled><legend>核对识别结果</legend>
      <label>统计频段<select name="pool"><option value="agent">限定代理人 · 独家频段</option><option value="engine">限定音擎 · 音擎频段</option></select></label>
      <label>限定 UP 数量<input name="count" type="number" inputmode="numeric" min="1" max="100000" step="1" required placeholder="未读清"></label>
      <label>平均每 UP 抽数<input name="avg" type="number" inputmode="decimal" min="1" step="any" required placeholder="未读清"></label>
      <label class="sg-sample" hidden><input name="submitSample" type="checkbox"><span>匿名提交到样本榜<small>仅限未经修改的识别结果。确认后提交卡池、UP 数、总抽数和随机设备标识。截图留在本机。</small></span></label>
      <button type="submit" class="sg-confirm" disabled>确认数据并鉴定</button>
    </fieldset>
  </section></div></form>`;
  document.body.append(dialog);activeDialog=dialog;
  const q=s=>dialog.querySelector(s), form=q('form'), fields=q('fieldset'), img=q('img');
  const status=q('.sg-status'), preview=q('.sg-preview'), upload=q('.sg-upload'), fileInput=q('[type=file]');
  const confirm=q('.sg-confirm'), sampleConsent=q('.sg-sample');
  const {pool,count,avg,submitSample}=form.elements;
  let job=0, worker=null, url='', result=null, samplesAvailable=false;
  let preloadedOcr;
  const edits={};
  const preferred=Object.hasOwn(limits,initialPool)?initialPool:'agent';
  function stopWorker(){
    const old=worker;worker=null;
    old?.terminate().catch(()=>{});
  }
  function updateConfirm(){
    confirm.disabled=fields.disabled||!count.value||!avg.value||!form.checkValidity();
  }
  function recognizedRecord() {
    if (result?.channels.length) return result.records[pool.value];
    if (pool.value===preferred) return result?.records.unknown;
  }
  function canSubmitSample() {
    const selected=pool.value;
    const recognized=result?.records[selected];
    return samplesAvailable
      && result?.channels.includes(selected)===true
      && !Object.hasOwn(edits,selected)
      && Number.isInteger(recognized?.count)
      && Number.isFinite(recognized?.avg)
      && recognized.count===count.valueAsNumber
      && recognized.avg===avg.valueAsNumber;
  }
  function updateSampleConsent() {
    sampleConsent.hidden=!canSubmitSample();
    if(sampleConsent.hidden)submitSample.checked=false;
  }
  sampleAvailability?.then(available=>{
    if(!dialog.open)return;
    samplesAvailable=available;
    updateSampleConsent();
  });
  function showPool(){
    const selected=pool.value;
    avg.max=limits[selected];
    const record=edits[selected]??recognizedRecord();
    count.value=record?.count??'';avg.value=record?.avg??'';
    const context=result.channels.length>1?'已识别多个频段，可切换核对。':result.channels.length?'':'频段沿用工作台选择，请核对。';
    const missing=[!count.value&&'UP 数量',!avg.value&&'平均抽数'].filter(Boolean);
    status.textContent=missing.length?context+'未读清'+missing.join('和')+'，可换一张清晰原图或补正后确认。':context+'请核对这两个数字，确认后生成报告。';
    updateSampleConsent();
    updateConfirm();
  }
  pool.onchange=async ()=>{
    submitSample.checked=false;
    const selected=pool.value, version=job;
    const record=result.records[selected];
    if(result.resume && !(record.count && record.avg)){
      fields.disabled=confirm.disabled=true;
      try{
        const next=await result.resume(selected);
        if(version!==job || !dialog.open)return;
        result=next;
      }catch{
        if(version!==job || !dialog.open)return;
        delete result.resume;
      }
      if(!result.resume)stopWorker();
      fields.disabled=false;
    }
    showPool();
  };
  for(const field of [count,avg])field.oninput=()=>{
    edits[pool.value]={count:count.value,avg:avg.value};
    updateSampleConsent();
    updateConfirm();
  };
  dialog.addEventListener('close',()=>{
    job++;
    stopWorker();
    preloadedOcr?.then(ocr=>ocr?.worker.terminate()).catch(()=>{});
    preloadedOcr=null;
    if(url)URL.revokeObjectURL(url);
    dialog.remove();if(activeDialog===dialog)activeDialog=null;
  },{once:true});
  q('[data-close]').onclick=()=>dialog.close();
  upload.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();fileInput.click();}};
  q('[data-replace]').onclick=()=>fileInput.click();
  q('[data-zoom]').onclick=e=>{
    const large=q('.sg-view').classList.toggle('sg-zoom');e.currentTarget.textContent=large?'适应宽度':'放大查看';
  };
  async function choose(file){
    if(!file)return;
    if(!/^image\/(png|jpeg|webp|avif)$/.test(file.type)){status.textContent='请选择 PNG、JPG、WebP 或 AVIF 图片。';return;}
    const version=++job;
    const current=()=>version===job && dialog.open;
    stopWorker();result=null;delete edits.agent;delete edits.engine;
    fields.hidden=fields.disabled=confirm.disabled=true;
    updateSampleConsent();
    count.value=avg.value='';
    if(url)URL.revokeObjectURL(url);
    url=URL.createObjectURL(file);img.src=url;
    q('.sg-view').classList.remove('sg-zoom');q('[data-zoom]').textContent='放大查看';
    try{await img.decode();}catch{if(current()){upload.hidden=false;preview.hidden=true;q('.sg-imgtools').hidden=true;status.textContent='图片无法打开，请重新选择。';}return;}
    if(!current())return;
    upload.hidden=true;preview.hidden=false;q('.sg-imgtools').hidden=false;
    const progress=text=>{if(current())status.textContent=text;};
    progress('正在启动本机文字识别…');
    const pending=preloadedOcr;
    preloadedOcr=null;
    let failed=false;
    try{
      let ocr=await pending;
      if(!ocr&&current())ocr=await startOcr();
      if(!current()){await ocr?.worker.terminate();return;}
      worker=ocr.worker;
      const found=await ocr.scanScreenshot(img,worker,current,progress,preferred);
      if(!current())return;
      result=found;
    }catch{
      if(!current())return;
      failed=true;result={channels:[],records:{agent:{},engine:{},unknown:{}}};
    }finally{if(current() && !result?.resume)stopWorker();}
    if(!current())return;
    pool.value=result.channels.includes(preferred)?preferred:result.channels[0]??preferred;
    fields.hidden=fields.disabled=false;showPool();
    if(failed)status.textContent='本机识别未能完成。请重选图片，或对照图片补正数字。';
  }
  fileInput.onchange=()=>{choose(fileInput.files[0]);fileInput.value='';};
  dialog.ondragover=e=>e.preventDefault();
  dialog.ondrop=e=>{e.preventDefault();choose(e.dataTransfer.files[0]);};
  form.onsubmit=e=>{
    e.preventDefault();
    if(!result||fields.disabled||!form.reportValidity())return;
    const record={
      pool:pool.value,
      count:count.valueAsNumber,
      avg:avg.valueAsNumber,
      submitSample:submitSample.checked&&canSubmitSample()
    };
    dialog.close();callback(record);
  };
  dialog.showModal();
  preloadedOcr=startOcr().catch(()=>null);
}
