// Keep OCR positions so each value is matched to its label and frequency band.
const headers = /独家重映|音擎回响|常驻频段|邦布频段|独家频段|音擎频段|限定代理人(?:池)?|限定音擎(?:池)?|角色活动(?:调频|池)|武器活动(?:调频|池)/g;
const labels = /(?:平均(?:每[个名位]?)?(?:获得|获取)?(?:一个|每个)?(?:限定|UP)(?:代理人|音擎|角色|信号)?(?:所需|所用|花费|调频|消耗|获取)?(?:抽数|次数|抽)?|(?:限定|UP)(?:代理人|音擎|角色)?平均(?:调频|获取|出货)?(?:抽数|次数|间隔)?|每(?:个|名|位)?(?:限定|UP)(?:平均)?(?:抽数|次数|用抽)|平均(?:每UP)?(?:调频次数|抽数|用抽)|平均(?=[:：])|(?:限定|UP)(?:代理人|音擎|角色|信号)?(?:获得|获取)?(?:数量|次数|个数|数)|(?:获得|获取)(?:限定|UP)(?:次数|数量)?|(?:限定|UP)(?=[:：]))/g;
const numbers = /\d+(?:\.\d+)?/g;
const normalize = text => text.normalize('NFKC').toUpperCase().replace(/\s+/g,'').replace(/[，、](?=\d)/g,'.');
const center = (a,b) => (a+b)/2;

function tokensInRow(words, pattern) {
  let text = '';
  const spans = [];
  for (const word of words) {
    const {x0,x1,y0,y1} = word.bbox;
    const value = normalize(word.text);
    if (!value) continue;
    if (spans.length && x0-spans.at(-1).x1 > (y1-y0)*.8) {
      text += ' ';
      spans.push({x0:spans.at(-1).x1,x1:x0,y0,y1});
    }
    for (let i=0;i<value.length;i++) {
      spans.push({x0:x0+(x1-x0)*i/value.length, x1:x0+(x1-x0)*(i+1)/value.length,y0,y1});
    }
    text += value;
  }
  return Array.from(text.matchAll(pattern), match => {
    const parts=spans.slice(match.index,match.index+match[0].length);
    const x0=parts[0].x0, x1=parts.at(-1).x1;
    const y0=Math.min(...parts.map(s=>s.y0)), y1=Math.max(...parts.map(s=>s.y1));
    return {text:match[0], before:text.slice(0,match.index), after:text.slice(match.index+match[0].length),
      x0,x1,y0,y1,x:center(x0,x1),y:center(y0,y1),h:Math.max(1,y1-y0)};
  });
}

function groupRows(words) {
  const rows=[];
  for (const w of [...words].sort((a,b)=>a.bbox.y0-b.bbox.y0)) {
    const {y0,y1}=w.bbox, h=y1-y0, y=center(y0,y1);
    let row=rows.findLast(r=>Math.abs(r.y-y)<.49*Math.max(r.h,h));
    if (!row) {row={y,h,words:[]};rows.push(row);}
    row.words.push(w);
  }
  return rows.map(r=>r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0));
}

function channel(header) {
  if (/独家频段|限定代理人|角色活动/.test(header)) return 'agent';
  if (/音擎频段|限定音擎|武器活动/.test(header)) return 'engine';
  return 'other';
}

function owningHeader(item, headings) {
  const above=headings.filter(h=>h.y<=item.y+.45*h.h);
  if(!above.length)return null;
  const levels=[];
  for(const h of above) {
    let level=levels.find(group=>Math.abs(group[0].y-h.y)<Math.max(group[0].h,h.h));
    if(!level){level=[];levels.push(level);}
    level.push(h);
  }
  // A new card/section heading supersedes the previous row of cards.
  const row=levels.sort((a,b)=>b[0].y-a[0].y)[0];
  return row.reduce((best,h)=>Math.abs(item.x-h.x)<Math.abs(item.x-best.x)?h:best);
}

export function readLayout(words, singleCard=false) {
  const rows=groupRows(words);
  const headings=rows.flatMap(r=>tokensInRow(r,headers))
    .filter(h=>!/(?:数|数量|平均|抽数)/.test(h.after.slice(0,2)) && !/(?:平均|每)$/.test(h.before));
  const anchors=rows.flatMap(r=>tokensInRow(r,labels));
  // On an official card the two UP rows are stacked: quantity, then average.
  // At small sizes Chinese OCR often reads 数量 as 效星. Use both the row
  // pattern and the legible average label before trusting an approximate label.
  if(singleCard && headings.length===1 && anchors.some(a=>a.text.startsWith('UP平均')) &&
      !anchors.some(a=>/数量|次数/.test(a.text))){
    const upper=rows.flatMap(row=>tokensInRow(row,/UP[数效敦教][量星呈](?=[:： 0-9]|$)/g));
    const avg=anchors.find(a=>a.text.startsWith('UP平均'));
    if(upper.length===1 && upper[0].y<avg.y && Math.abs(upper[0].x-avg.x)<avg.h*2) {
      anchors.push({...upper[0],text:'UP数量'});
    }
  }
  const values=rows.flatMap(r=>tokensInRow(r,numbers))
    .filter(v=>!/^\s*%/.test(v.after) && v.text.length<=7);
  const records={agent:{},engine:{},unknown:{}};
  for(const anchor of anchors){
    const header=owningHeader(anchor,headings);
    const pool=header?channel(header.text):'unknown';
    if(pool==='other'||(!header && headings.length))continue;
    const kind=/平均|每/.test(anchor.text)?'avg':'count';
    if((/S级|S級|出金/.test(anchor.before.slice(-5)) || /S级|出金/.test(anchor.after.slice(0,4))) && !/UP|限定/.test(anchor.text))continue;
    if(/^平均$/.test(anchor.text)&&!header)continue;
    const possible=[];
    for(const v of values){
      const num=Number(v.text);
      if(num<1 || (kind==='count'?(!Number.isInteger(num)||num>100000):num>(pool==='engine'?160:180)))continue;
      const sameRow=Math.abs(v.y-anchor.y)<.65*Math.max(v.h,anchor.h);
      const height=Math.max(anchor.h,v.h);
      let distance=Infinity;
      if(sameRow && v.x0>=anchor.x1-1)distance=(v.x0-anchor.x1)/height;
      else if(sameRow && v.x1<=anchor.x0+1)distance=1.5+(anchor.x0-v.x1)/height;
      else if(!sameRow && Math.abs(v.y-anchor.y)<3.7*height && Math.abs(v.x-anchor.x)<Math.max(1.8*height,(anchor.x1-anchor.x0)/2)) {
        distance=2+Math.abs(v.y-anchor.y)/height+Math.abs(v.x-anchor.x)/height;
      }
      if(distance>8)continue;
      if(owningHeader(v,headings)!==header)continue;
      // Never cross another metric label on the way to a value.
      if(sameRow && anchors.some(a=>a!==anchor && Math.abs(a.y-anchor.y)<height*.6 && a.x>Math.min(v.x,anchor.x)&&a.x<Math.max(v.x,anchor.x)))continue;
      possible.push({num,distance,value:v});
    }
    possible.sort((a,b)=>a.distance-b.distance);
    if(!possible.length || (possible.length>1 && possible[0].num!==possible[1].num && possible[1].distance-possible[0].distance<.6))continue;
    const best=possible[0];
    const record=records[pool];
    if(!record[kind])record[kind]=[];
    record[kind].push(best);
  }
  for(const record of Object.values(records)) {
    const count=record.count, avg=record.avg;
    for(const kind of ['count','avg']){
      const matches=record[kind]||[];
      const unique=new Set(matches.map(m=>m.num));
      delete record[kind];
      if(unique.size===1)record[kind]=matches[0].num;
    }
    if(count&&avg&&count.some(c=>avg.some(a=>a.value===c.value))){delete record.count;delete record.avg;}
  }
  return {records, channels:[...new Set(headings.map(h=>channel(h.text)).filter(p=>p!=='other'))]};
}

export function wordsFrom(data) {
  return (data.blocks||[]).flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(line=>line.words)));
}
