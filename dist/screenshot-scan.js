import { readLayout, wordsFrom } from './screenshot-layout.js?v=2';

function renderRegion(image, box, scale, enhance) {
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(box.w*scale));
  canvas.height=Math.max(1,Math.round(box.h*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:enhance});
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,box.x,box.y,box.w,box.h,0,0,canvas.width,canvas.height);
  if(enhance){
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    // White type on the saturated summary cards becomes dark text on white paper.
    for(let i=0;i<pixels.data.length;i+=4){
      const level=255-Math.min(255,Math.max(0,(Math.min(pixels.data[i],pixels.data[i+1],pixels.data[i+2])-110)*2.5));
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=level;
    }
    ctx.putImageData(pixels,0,0);
  }
  return canvas;
}

function warmCards(image) {
  const w=image.naturalWidth,h=image.naturalHeight;
  const scale=Math.min(1,480/w,3600/h);
  const canvas=renderRegion(image,{x:0,y:0,w,h},scale,false);
  const cols=canvas.width, rows=canvas.height;
  const pixels=canvas.getContext('2d').getImageData(0,0,cols,rows).data;
  const mask=new Uint8Array(cols*rows), queue=new Int32Array(mask.length);
  for(let i=0;i<mask.length;i++){
    const r=pixels[i*4],g=pixels[i*4+1],b=pixels[i*4+2];
    mask[i]=r>105 && r>g*1.4 && g>b*.9 && r-b>55;
  }
  const boxes=[];
  for(let i=0;i<mask.length;i++){
    if(!mask[i])continue;
    let start=0,end=1,minX=cols,maxX=0,minY=rows,maxY=0;queue[0]=i;mask[i]=0;
    while(start<end){
      const index=queue[start++],x=index%cols,y=Math.floor(index/cols);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const j of [x>0?index-1:-1,x+1<cols?index+1:-1,index-cols,index+cols]){
        if(j>=0 && j<mask.length && mask[j]){mask[j]=0;queue[end++]=j;}
      }
    }
    const bw=maxX-minX+1,bh=maxY-minY+1;
    if(bw<cols*.12||bh<12||bw/bh<.5||bw/bh>4.5||end<bw*bh*.48)continue;
    const pad=2;
    const x=Math.max(0,(minX-pad)/scale),y=Math.max(0,(minY-pad)/scale);
    boxes.push({x,y,w:Math.min(w-x,(bw+2*pad)/scale),h:Math.min(h-y,(bh+2*pad)/scale)});
  }
  return boxes.sort((a,b)=>a.y-b.y||a.x-b.x).slice(0,12);
}

export async function scanScreenshot(image,worker,stillCurrent,progress,targetPool) {
  const w=image.naturalWidth,h=image.naturalHeight;
  const whole={x:0,y:0,w,h};
  const collected={agent:{},engine:{},unknown:{}};
  const detected=new Set();
  function absorb(layout,allowUnknown) {
    layout.channels.forEach(p=>detected.add(p));
    for(const [pool,record] of Object.entries(layout.records)){
      if(pool==='unknown'&&!allowUnknown)continue;
      for(const [key,value] of Object.entries(record)){
        (collected[pool][key]??=new Set()).add(value);
      }
    }
  }
  async function read(box,scale,enhance=false,mode='11'){
    if(!stillCurrent())throw Error('cancelled');
    const canvas=renderRegion(image,box,scale,enhance);
    try {
      const {data}=await worker.recognize(canvas,{tessedit_pageseg_mode:mode}, {blocks:true,text:false});
      return wordsFrom(data);
    } finally {canvas.width=canvas.height=1;}
  }
  function complete(record){return record.count?.size===1&&record.avg?.size===1;}
  function enough(){
    if(detected.size)return [...detected].every(p=>complete(collected[p]));
    return complete(collected.unknown);
  }
  function snapshot(){
    const records={};
    for(const [pool,fields] of Object.entries(collected)){
      records[pool]={};
      for(const [key,values] of Object.entries(fields))if(values.size===1)records[pool][key]=[...values][0];
    }
    return {records,channels:[...detected]};
  }
  function hasPool(layout,pool){
    const record=layout.records[pool];
    return layout.channels.includes(pool)&&record?.count!=null&&record.avg!=null;
  }
  async function* segments(){
    const scale=Math.min(2.5,1650/w);
    const span=Math.min(h,Math.max(1,Math.floor(1600/scale)));
    const stride=Math.max(1,Math.floor(span*.82));
    const positioned=[];
    let top=0, lowerBound=0;
    while(true){
      const bottom=top+span;
      const last=bottom>=h;
      const nextTop=Math.min(top+stride,h-span);
      const upperBound=last?h:(bottom+nextTop)/2;
      progress('正在精读统计区域 '+Math.round(100*bottom/h)+'%…');
      const words=await read({x:0,y:top,w,h:span},scale);
      for(const word of words){
        const b=word.bbox;
        const centerY=top+(b.y0+b.y1)/(2*scale);
        if(centerY<lowerBound || centerY>=upperBound)continue;
        positioned.push({text:word.text,bbox:{x0:b.x0/scale,x1:b.x1/scale,y0:top+b.y0/scale,y1:top+b.y1/scale}});
      }
      if(last)return readLayout(positioned);
      // Keep page coordinates so a heading can own fields in the next strip.
      if(longImage && words.length)yield readLayout(positioned);
      top=nextTop;
      lowerBound=upperBound;
    }
  }
  const longImage=h>w*3.5;
  async function* scanStages(){
    if(longImage){
      const layout=yield* segments();
      absorb(layout,true);
      yield layout;
    }
    progress('正在整图识别频段和统计字段…');
    absorb(readLayout(await read(whole,Math.min(1.6,1550/w,2800/h))),true);
    if(longImage)yield snapshot();
    if(!enough() || longImage){
      progress('正在自动定位统计卡片…');
      for(const box of warmCards(image)){
        const scale=Math.min(4,800/box.w,750/box.h);
        absorb(readLayout(await read(box,scale,true,'6'),true),false);
        if(longImage)yield snapshot();
      }
    }
    if(!longImage && !enough())absorb(yield* segments(),true);
    return snapshot();
  }
  const stages=scanStages();
  async function readUntil(pool){
    while(true){
      const {value,done}=await stages.next();
      if(done || (hasPool(value,'agent') && hasPool(value,'engine')))return value;
      if(hasPool(value,pool))return {...value,resume:readUntil};
    }
  }
  return readUntil(targetPool);
}
