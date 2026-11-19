import assert from 'node:assert/strict';
import { readLayout } from '../dist/screenshot-layout.js';

function word(text,x,y,width) {
  return {text,bbox:{x0:x,x1:x+width,y0:y,y1:y+16}};
}
function card(name,x,count,avg) {
  return [word(name,x,0,70), word('调频次数',x,30,66), word('273',x+80,30,35),
    word('UP数量:',x,70,70), word(count,x+82,70,24),
    word('UP平均:',x,96,70), word(avg,x+82,96,50)];
}
const left=card('独家频段',0,'15','83.25');
const middle=card('音擎频段',160,'8','67.5');
const replay=card('独家重映',320,'2','40');
assert.deepEqual(readLayout([...left,...middle,...replay]).records,{
  agent:{count:15,avg:83.25},engine:{count:8,avg:67.5},unknown:{}
});
assert.deepEqual(readLayout(replay).records.agent,{});
assert.deepEqual(readLayout(left.filter(w=>w.text!=='15')).records.agent.count,undefined);
assert.deepEqual(readLayout([...left,...card('独家频段',160,'9','70')]).records.agent,{});
const blurry=middle.map(w=>w.text==='UP数量:'?{...w,text:'UP效星:'}:w);
assert.deepEqual(readLayout(blurry,true).records.engine,{count:8,avg:67.5});
console.log('Screenshot layout checks passed');
