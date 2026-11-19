import { encodeTicketUrl } from './qr/encode.js';

const ink = '#1b1e19';
const paper = '#f4f1e7';
const lime = '#c8fa36';
const orange = '#ff7039';
const muted = '#54564a';
const sans = '"Inter","Arial","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const mono = '"IBM Plex Mono","Menlo","Consolas","DejaVu Sans Mono",monospace';
const heavy = '"Arial Black","Arial","Noto Sans CJK SC",sans-serif';
const width = 1160, height = 512, seam = 859;

function loadImage(path) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = new URL(path, import.meta.url).href;
  });
}
const stockImages = Promise.all([loadImage('./hero.webp'), loadImage('./ticket-grain.png')]);

function polygon(ctx, points, fill) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}

function label(ctx, value, x, y, size, options = {}) {
  const {weight = 700, color = ink, face = sans, max, align = 'left'} = options;
  ctx.font = weight + ' ' + size + 'px ' + face;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  const text = String(value);
  ctx.fillText(text, x, y, max ?? 3000);
}

function stroke(ctx, x1, y1, x2, y2, color, weight = 1, dash = []) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}

function surface(ctx, grain) {
  ctx.fillStyle = paper; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = lime; ctx.fillRect(seam, 0, width - seam, height);
  if (grain) {
    ctx.fillStyle = ctx.createPattern(grain, 'repeat');
    ctx.fillRect(0, 0, width, height);
  }
}

function poster(ctx, image) {
  ctx.save();
  // A torn edge lets the same station artwork run into the ticket stock.
  polygon(ctx, [[477,54],[seam,54],[seam,313],[468,313],[482,298],[457,305],
    [484,273],[471,277],[494,247],[479,251],[504,223],[482,223],
    [508,191],[496,193],[515,160],[499,164],[515,134],[489,140],
    [509,105],[489,111],[504,85],[480,94],[489,71]], null);
  ctx.clip();
  if (image) {
    const cropWidth = image.height * (seam - 450) / 259;
    ctx.drawImage(image,image.width-cropWidth,0,cropWidth,image.height,450,54,seam-450,259);
  } else {
    ctx.fillStyle = ink; ctx.fillRect(450,54,seam-450,259);
    for (let x = 450; x < seam + 150; x += 34) {
      polygon(ctx, [[x,54],[x+12,54],[x-128,313],[x-140,313]], lime);
    }
  }
  ctx.restore();
}

function percentileLabel(value) {
  if (value > 99.99) return '>99.99';
  if (value < .01) return '<0.01';
  return value.toFixed(2);
}

function pulls(value, count) {
  // One total pull changes a 100,000-UP mean by 0.00001.
  const digits = Math.min(5, Math.max(2, Math.ceil(Math.log10(count))));
  return Number(value.toFixed(digits)).toString();
}

function drawChart(ctx, result) {
  const x = 28, y = 384, w = seam - x - 26, h = 68;
  label(ctx,'概率分布',x,349,23,{weight:900});
  label(ctx,'/  平均每 UP 抽数',x+107,348,16,{color:muted});
  ctx.fillStyle = orange; ctx.fillRect(seam - 117,336,11,11);
  label(ctx,'你的落点',seam-96,348,16);
  const bins = result.bins;
  const peak = Math.max(...bins.map(bin => bin.probability),Number.EPSILON);
  stroke(ctx,x,y+15,x+w,y+15,'#aaa998',1,[2,6]);
  stroke(ctx,x,y+41,x+w,y+41,'#aaa998',1,[2,6]);
  const unit = w / bins.length;
  bins.forEach((bin, i) => {
    const bar = Math.max(2,h*bin.probability/peak);
    const left = x + i*unit + 2;
    const center = left + (unit-4)/2;
    if (bin.current) {
      ctx.fillStyle = '#ebdeba'; ctx.fillRect(left,y-7,unit-4,h+7);
      polygon(ctx, [[center-5,y-14],[center+5,y-14],[center,y-8]],ink);
    }
    ctx.fillStyle = bin.current ? orange : ink;
    ctx.fillRect(left, y+h-bar, unit-4, bar);
  });
  stroke(ctx,x,y+h+1,x+w,y+h+1,ink,2);
  const min = bins[0], max = bins[bins.length-1];
  const low = (min.tail ? '≤ ' : '') + pulls(min.tail ? min.high : min.low, result.count);
  const high = (max.tail ? '≥ ' : '') + pulls(max.tail ? max.low : max.high, result.count);
  label(ctx,low,x,477,17,{face:mono});
  label(ctx,high,x+w,477,17,{face:mono,align:'right'});
}

function drawResultCode(ctx, modules, scale) {
  // Snap each module to whole output pixels, including the four-module quiet zone.
  const cells = modules.length + 8;
  const step = Math.floor(202 * scale / cells);
  const size = cells * step;
  const x = Math.round((width - 18) * scale) - size;
  const y = Math.round(405 * scale - size / 2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = lime;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = ink;
  modules.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) ctx.fillRect(x + (c + 4) * step, y + (r + 4) * step, step, step);
  }));
  ctx.restore();
}

function punch(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (const y of [0,height]) {
    ctx.beginPath(); ctx.arc(seam,y,14,0,2*Math.PI); ctx.fill();
  }
  for (const x of [0,width]) {
    for (let y=14;y<height;y+=18) {
      ctx.beginPath(); ctx.arc(x,y,3.5,0,2*Math.PI); ctx.fill();
    }
  }
  ctx.restore();
}

async function drawTicket(result, tier, demo, scale, modules) {
  const [image, grain] = await stockImages;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale,scale);
  surface(ctx,grain);
  poster(ctx,image);

  ctx.fillStyle = ink; ctx.fillRect(0,0,seam,54);
  for(let i=0;i<3;i++) polygon(ctx, [[26+i*10,35],[35+i*10,17],[42+i*10,17],[33+i*10,35]], lime);
  label(ctx,'SIGNAL LAB',66,37,27,{face:heavy,weight:900,color:lime});
  label(ctx,'新艾利都 · 调频实验室',seam-24,35,20,{color:paper,align:'right'});
  stroke(ctx,27,104,54,104,orange,5);
  label(ctx,'理论欧气百分位',66,110,26,{weight:900});
  const score = percentileLabel(result.percentile);
  const largeSize = score.length > 5 ? 88 : 106;
  const scoreFont = '900 '+largeSize+'px '+heavy;
  ctx.font = scoreFont;
  const scoreWidth = Math.min(ctx.measureText(score).width,340);
  label(ctx,score,24,219,largeSize,{weight:900,face:heavy,max:340});
  label(ctx,'%',32+scoreWidth,218,43,{weight:900,face:heavy});
  const verdict = typeof tier === 'function' ? tier(result.percentile) : tier;
  if (verdict) {
    ctx.save();
    ctx.translate(31,245); ctx.rotate(-.033);
    ctx.font = '900 29px '+sans;
    const sticker = Math.min(ctx.measureText(verdict).width,188)+30;
    polygon(ctx,[[4,0],[sticker,0],[sticker-5,42],[0,42]],ink);
    label(ctx,verdict,14,32,29,{weight:900,color:lime,max:188});
    ctx.restore();
  }
  ctx.fillStyle = ink; ctx.fillRect(seam-138,277,138,36);
  label(ctx,demo?'示例鉴定票':'欧非鉴定票',seam-19,302,20,{align:'right',color:paper});
  stroke(ctx,0,314,seam,314,ink,3);
  drawChart(ctx,result);

  const sx = seam + 25;
  label(ctx,'调频票根',sx,52,32,{weight:900});
  label(ctx,'SIGNAL TICKET / STUB',sx,77,16,{face:mono});
  stroke(ctx,sx,92,width-25,92,ink,2);
  label(ctx,'调频频道',sx,120,17,{color:muted});
  label(ctx,result.pool === 'agent' ? '限定代理人' : '限定音擎',sx,156,31,{weight:900});
  stroke(ctx,sx,169,width-25,169,'#657043',1,[3,4]);
  label(ctx,'限定 UP 数量',sx,190,17,{color:muted});
  label(ctx,result.count.toLocaleString('en-US'),sx,225,36,{weight:900,face:heavy,max:239});
  stroke(ctx,sx,235,width-25,235,'#657043',1,[3,4]);
  label(ctx,'平均每 UP 抽数',sx,256,17,{color:muted});
  label(ctx,pulls(result.average,result.count),sx,291,36,{weight:900,face:heavy,max:239});
  stroke(ctx,sx,301,width-25,301,ink,2);
  label(ctx,'扫码',sx,400,17,{weight:900});
  label(ctx,'看结果',sx,426,17,{weight:900});
  drawResultCode(ctx,modules,scale);

  stroke(ctx,seam,13,seam,height-13,ink,2,[6,7]);
  punch(ctx);
  return canvas;
}

// Keep only the current ticket. Preview paints directly from its canvas.
// A full-resolution PNG is encoded only when the user asks for a download.
let lastTicket;
export function getTicket(result, tier, demo, scale, url) {
  if (lastTicket?.result === result && lastTicket.demo === demo && lastTicket.scale === scale && lastTicket.url === url) {
    return lastTicket;
  }
  const modules = encodeTicketUrl(url);
  const preview = drawTicket(result, tier, demo, scale, modules);
  let png;
  const ticket = {
    result, demo, scale, url, preview,
    exportPng() {
      if (!png) {
        const full = scale === 2 ? preview : drawTicket(result, tier, demo, 2, modules);
        png = full.then(canvas => new Promise((resolve, reject) =>
          canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG 导出失败')), 'image/png')
        )).catch(error => { png = undefined; throw error; });
      }
      return png;
    }
  };
  lastTicket = ticket;
  preview.catch(() => { if (lastTicket === ticket) lastTicket = undefined; });
  return ticket;
}
