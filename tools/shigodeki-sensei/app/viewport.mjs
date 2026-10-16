// Zoom the notebook independently of the app controls. Ink keeps its canonical coordinates.
export class PaperViewport {
  constructor(viewport, paper, canvas, ink, controls) {
    Object.assign(this, {viewport, paper, canvas, ink, controls});
    this.zoom = 1;
    this.touches = new Map();
    this.shell = document.createElement('div');
    this.shell.className = 'paper-shell';
    viewport.append(this.shell);
    this.shell.append(paper);
    paper.style.position = 'absolute';
    controls.out.onclick = () => this.setZoom(this.zoom / 1.2);
    controls.in.onclick = () => this.setZoom(this.zoom * 1.2);
    controls.fit.onclick = () => { this.setZoom(1); viewport.scrollTo(0, 0); };
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
      viewport.addEventListener(event, e => this.pointer(e), {capture: true});
    viewport.addEventListener('click', e => {
      if (this.suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    viewport.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      this.setZoom(this.zoom * Math.exp(-e.deltaY * .01), e.clientX-r.left, e.clientY-r.top);
    }, {passive: false});
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(viewport);
  }
  resize() {
    const {viewport, paper, canvas, shell} = this;
    const width = viewport.clientWidth;
    if (!width) return;
    const landscape = matchMedia('(orientation: landscape)').matches;
    const remaining = Math.max(80, (window.visualViewport?.height || innerHeight) - viewport.getBoundingClientRect().top - 42);
    this.fitScale = width / 1200;
    const height = landscape ? remaining / this.fitScale : 848;
    viewport.style.height = `${height * this.fitScale}px`;
    this.scale = this.fitScale * this.zoom;
    shell.style.width = `${1200 * this.scale}px`;
    shell.style.height = `${height * this.scale}px`;
    paper.style.height = canvas.style.height = `${height}px`;
    paper.style.transform = `scale(${this.scale})`;
    paper.classList.toggle('compact-sheet', height < 600);
    this.controls.level.textContent = `${Math.round(this.zoom * 100)}%`;
    this.controls.out.disabled = this.zoom <= .5;
    this.controls.in.disabled = this.zoom >= 3;
  }
  setZoom(value, x = this.viewport.clientWidth/2, y = this.viewport.clientHeight/2) {
    const old = this.scale || 1;
    const anchor = [(this.viewport.scrollLeft+x)/old, (this.viewport.scrollTop+y)/old];
    this.zoom = Math.max(.5, Math.min(3, value));
    this.resize();
    this.viewport.scrollLeft = anchor[0]*this.scale-x;
    this.viewport.scrollTop = anchor[1]*this.scale-y;
  }
  pointer(e) {
    if (e.pointerType !== 'touch') return;
    const {viewport, touches} = this;
    if (e.type === 'pointerdown') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 1) {
        this.suppressClick = false;
        this.pan = {x:e.clientX, y:e.clientY, left:viewport.scrollLeft, top:viewport.scrollTop};
      }
      if (touches.size === 2) {
        this.ink.cancel();
        const [a,b] = [...touches.values()], r = viewport.getBoundingClientRect();
        this.pinch = {
          distance:Math.max(1, Math.hypot(b[0]-a[0], b[1]-a[1])), zoom:this.zoom,
          anchor:[(viewport.scrollLeft+(a[0]+b[0])/2-r.left)/this.scale,
            (viewport.scrollTop+(a[1]+b[1])/2-r.top)/this.scale]
        };
        this.pan = null;
        this.suppressClick = true;
        for (const id of touches.keys()) viewport.setPointerCapture(id);
      }
    } else if (e.type === 'pointermove' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pinch && touches.size >= 2) {
        const [a,b] = [...touches.values()], r = viewport.getBoundingClientRect();
        this.zoom = Math.max(.5, Math.min(3, this.pinch.zoom * Math.hypot(b[0]-a[0], b[1]-a[1]) / this.pinch.distance));
        this.resize();
        viewport.scrollLeft = this.pinch.anchor[0]*this.scale - ((a[0]+b[0])/2-r.left);
        viewport.scrollTop = this.pinch.anchor[1]*this.scale - ((a[1]+b[1])/2-r.top);
      } else if (this.pan && (this.ink.mode === 'edit' || this.ink.pencilOnly())) {
        const dx=e.clientX-this.pan.x, dy=e.clientY-this.pan.y;
        if (Math.hypot(dx,dy)>6 || this.suppressClick) {
          this.suppressClick=true;
          viewport.setPointerCapture(e.pointerId);
          viewport.scrollLeft=this.pan.left-dx;
          viewport.scrollTop=this.pan.top-dy;
        }
      }
    } else if (e.type === 'pointerup' || e.type === 'pointercancel') {
      touches.delete(e.pointerId);
      if (touches.size < 2 && this.pinch) { this.pinch=null; this.pan=null; }
      if (!touches.size) {
        this.pan=null;
        setTimeout(() => { this.suppressClick=false; }, 0);
      }
    }
    if (this.pinch || this.suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
}
