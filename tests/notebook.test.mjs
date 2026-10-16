import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,setSlot,slotAt} from '../tools/shigodeki-sensei/app/model.mjs';
import {plannerData,annualMarkup,weekMarkup,monthsOf} from '../tools/shigodeki-sensei/app/sheets.mjs';
import {validateState} from '../tools/shigodeki-sensei/app/validation.mjs';
import {Ink} from '../tools/shigodeki-sensei/app/ink.mjs';
test('annual pages cover the school year including leap day and safely share event text',()=>{
 const s=createState(2027),p=plannerData(s);p.events['2028-02-29']='<script>test</script>';
 assert.deepEqual(monthsOf(2027).at(-1),{year:2028,month:3});
 for(const kind of ['blocks','list']){
  const html=annualMarkup(s,kind);
  assert.equal((html.match(/data-event=/g)||[]).length,366);
  assert.ok(html.includes('2028-02-29'));assert.ok(!html.includes('<script>'));
 }
 assert.ok(weekMarkup(s,'2028-02-28').includes('&lt;script&gt;'));
 assert.equal((weekMarkup(s,'2028-02-28').match(/data-period=/g)||[]).length,30);
 assert.equal((weekMarkup(s,'2028-02-28',true).match(/data-period=/g)||[]).length,42);
});
test('notebook fields, palette and annual ink survive validation; invalid dates/fields/ink fail',()=>{
 const s=createState(2026),p=plannerData(s);
 p.events['2026-04-01']='始業式';p.weeks['2026-03-30']={'2026-04-01:朝':'朝読書','plan-text-0':'計画'};
 p.palette[0]='#123456';p.ink.blocks=[{tool:'pen',color:'#123456',width:2,points:[[0,0,.5],[1200,920,.5]]}];
 assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))).planner,p);
 for(const mutate of [x=>x.planner.events['2026-02-30']='bad',x=>x.planner.weeks['2026-03-30']['2026-04-15:朝']='bad',x=>x.planner.palette[0]='red',x=>x.planner.ink.blocks[0].points[1][0]=1201,x=>x.ink.free=[]]){
  const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateState(bad));
 }
});
test('changed lessons display a change label and legacy cancelled lessons remain empty',()=>{
 const s=createState(2026);s.lessons=[{id:'a',name:'国語',color:'#112233'}];
 setSlot(s,'2026-04-06',1,{lessonId:'a',status:'planned'});
 assert.ok(weekMarkup(s,'2026-04-06').includes('change-marker">変更'));
 setSlot(s,'2026-04-06',1,{lessonId:'a',status:'cancelled'});
 assert.equal(slotAt(s,'2026-04-06',1).lessonId,'');
});
test('holiday shading includes morning, lunch and after school; headers put dates before weekdays',()=>{
 const html=weekMarkup(createState(2026),'2026-10-12');
 for(const period of ['朝','昼','業後'])assert.ok(html.includes(`class="sheet-write closed" data-field="2026-10-12:${period}"`));
 assert.ok(html.includes('<strong>10/12</strong><strong>月</strong>'));
 assert.equal((html.match(/lesson-cell [^\"]*closed/g)||[]).length,6);
});
test('straight strokes retain only endpoints; hold-to-straighten supports undo, redo and cancellation',async()=>{
 const ctx=new Proxy({},{get:()=>()=>{}}),canvas=()=>({getContext:()=>ctx,addEventListener(){},classList:{toggle(){}},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:1200,height:920})});
 globalThis.document={createElement:canvas};globalThis.devicePixelRatio=1;globalThis.requestAnimationFrame=()=>1;
 const saved=[],ink=new Ink(canvas(),{onChange:s=>saved.push(s),onHistory(){},pencilOnly:()=>false});
 const event=(x,y)=>({clientX:x,clientY:y,pointerId:1,pointerType:'pen',pressure:.5,button:0,preventDefault(){}});
 ink.setMode('line');ink.down(event(10,10));ink.move(event(30,80));ink.move(event(150,70));ink.up(event(200,80));
 assert.deepEqual(ink.strokes[0].points,[[10,10,.5],[200,80,.5]]);assert.equal(ink.strokes[0].tool,'pen');
 ink.undo();assert.equal(ink.strokes.length,0);ink.redo();assert.equal(ink.strokes.length,1);
 ink.setMode('pen');ink.down(event(50,50));ink.move(event(70,90));ink.move(event(100,70));
 await new Promise(r=>setTimeout(r,640));assert.equal(ink.current.points.length,2);
 ink.move(event(120,90));ink.up(event(120,90));assert.equal(ink.strokes[1].points.length,2);
 ink.down(event(0,0));ink.move(event(100,100));ink.up(event(100,100),true);
 await new Promise(r=>setTimeout(r,640));assert.equal(ink.strokes.length,2);assert.equal(ink.current,null);
});
