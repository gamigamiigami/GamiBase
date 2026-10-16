import test from 'node:test';
import assert from 'node:assert/strict';
import {PaperViewport} from '../tools/shigodeki-sensei/app/viewport.mjs';

function fixture() {
  const element=()=>({style:{},append(){},addEventListener(){},classList:{toggle(){}}});
  globalThis.document={createElement:element};
  globalThis.window={addEventListener(){},visualViewport:{height:800,addEventListener(){}}};
  globalThis.matchMedia=()=>({matches:true});
  globalThis.ResizeObserver=class {observe(){}};
  const viewport={...element(),clientWidth:1200,clientHeight:600,scrollLeft:0,scrollTop:0,
    getBoundingClientRect:()=>({left:0,top:100}),setPointerCapture(){},scrollTo(x,y){this.scrollLeft=x;this.scrollTop=y;}};
  const ink={mode:'pen',pencilOnly:()=>true,cancellations:0,cancel(){this.cancellations++;}};
  const controls={out:{},in:{},fit:{},level:{}};
  const view=new PaperViewport(viewport,element(),element(),ink,controls);
  view.resize();return {view,viewport,ink,controls};
}
function touch(type,id,x,y) {return {type,pointerType:'touch',pointerId:id,clientX:x,clientY:y,preventDefault(){},stopImmediatePropagation(){}};}

test('fit fills available width; zoom changes only the notebook and fit restores its position',()=>{
  const {view,viewport,controls}=fixture();
  assert.equal(view.shell.style.width,'1200px');
  assert.equal(viewport.style.height,'658px');
  controls.in.onclick();assert.equal(controls.level.textContent,'120%');
  assert.equal(viewport.scrollLeft,120);
  view.setZoom(10);assert.equal(view.zoom,3);assert.equal(controls.in.disabled,true);
  view.setZoom(.1);assert.equal(view.zoom,.5);assert.equal(controls.out.disabled,true);
  controls.fit.onclick();assert.equal(view.zoom,1);assert.equal(viewport.scrollLeft,0);assert.equal(viewport.scrollTop,0);
});
test('two fingers cancel a pending stroke and pinch around their midpoint; one finger pans without drawing',()=>{
  const {view,viewport,ink}=fixture();
  view.pointer(touch('pointerdown',1,300,300));
  view.pointer(touch('pointerdown',2,500,300));
  assert.equal(ink.cancellations,1);
  view.pointer(touch('pointermove',2,700,300));
  assert.equal(view.zoom,2);assert.equal(viewport.scrollLeft,300);assert.equal(viewport.scrollTop,200);
  view.pointer(touch('pointerup',2,700,300));view.pointer(touch('pointerup',1,300,300));
  view.pointer(touch('pointerdown',3,200,300));view.pointer(touch('pointermove',3,150,250));
  assert.equal(viewport.scrollLeft,350);assert.equal(viewport.scrollTop,250);
  view.pointer(touch('pointerup',3,150,250));
  assert.equal(view.touches.size,0);assert.equal(view.pinch,null);
});
