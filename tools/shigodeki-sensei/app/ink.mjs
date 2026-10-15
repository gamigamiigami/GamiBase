const W = 1200,
  H = 920;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function distance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  const t = length
    ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length, 0, 1)
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export class Ink {
  constructor(canvas, { onChange, onHistory, pencilOnly }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.base = document.createElement("canvas");
    this.baseCtx = this.base.getContext("2d");
    this.ratio = Math.min(devicePixelRatio || 1, 2);
    for (const target of [canvas, this.base]) {
      target.width = W * this.ratio;
      target.height = H * this.ratio;
      target.getContext("2d").scale(this.ratio, this.ratio);
    }
    this.onChange = onChange;
    this.onHistory = onHistory;
    this.pencilOnly = pencilOnly;
    this.mode = "edit";
    this.color = "#30483f";
    this.width = 2;
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e, true));
    canvas.addEventListener("lostpointercapture", (e) => this.up(e, true));
  }
  point(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      clamp(((e.clientX - rect.left) / rect.width) * W, 0, W),
      clamp(((e.clientY - rect.top) / rect.height) * H, 0, H),
      e.pointerType === "pen" ? clamp(e.pressure || 0.2, 0, 1) : 0.5,
    ];
  }
  set(strokes) {
    this.finish();
    this.strokes = strokes || [];
    this.undoStack = [];
    this.redoStack = [];
    this.refresh();
  }
  setMode(mode) {
    this.finish();
    this.mode = mode;
    this.canvas.classList.toggle("writing", mode !== "edit");
  }
  drawStroke(ctx, stroke) {
    const pts = stroke.points;
    if (!pts.length) return;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.tool === "marker") {
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(
        pts[0][0],
        pts[0][1],
        (stroke.width * (0.4 + 0.6 * pts[0][2])) / 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      for (let i = 1; i < pts.length; i++) {
        ctx.lineWidth =
          stroke.width * (0.4 + (0.6 * (pts[i][2] + pts[i - 1][2])) / 2);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
        ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  repaintBase() {
    this.baseCtx.clearRect(0, 0, W, H);
    for (const stroke of this.strokes) this.drawStroke(this.baseCtx, stroke);
  }
  paint() {
    this.ctx.clearRect(0, 0, W, H);
    this.ctx.drawImage(this.base, 0, 0, W, H);
    if (this.current) this.drawStroke(this.ctx, this.current);
  }
  refresh() {
    this.repaintBase();
    this.paint();
    this.onHistory(this.undoStack.length > 0, this.redoStack.length > 0);
  }
  remember() {
    this.undoStack.push(this.strokes);
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }
  down(e) {
    if (this.mode === "edit" || this.pointer != null || e.button !== 0) return;
    if (e.pointerType === "touch" && this.pencilOnly()) {
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    this.pan = null;
    e.preventDefault();
    this.pointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.before = this.strokes;
    this.straight = this.mode === "line";
    if (this.mode === "eraser") this.erase(this.point(e));
    else
      this.current = {
        tool: this.mode === "line" ? "pen" : this.mode,
        color: this.color,
        width: this.mode === "marker" ? this.width * 3 : this.width,
        points: [this.point(e)],
      };
    this.paint();
  }
  move(e) {
    if (this.pan?.id === e.pointerId && this.pointer == null) {
      this.canvas.closest(".paper-viewport").scrollLeft -=
        e.clientX - this.pan.x;
      window.scrollBy(0, this.pan.y - e.clientY);
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerId !== this.pointer) return;
    e.preventDefault();
    for (const event of e.getCoalescedEvents?.().length
      ? e.getCoalescedEvents()
      : [e]) {
      const point = this.point(event);
      if (this.mode === "eraser") this.erase(point);
      else if (this.current && this.straight) {
        this.current.points = [this.current.points[0], point];
      } else if (
        this.current &&
        Math.hypot(
          point[0] - this.current.points.at(-1)[0],
          point[1] - this.current.points.at(-1)[1],
        ) > 0.4
      ) {
        this.current.points.push(point);
        this.scheduleStraighten();
      }
    }
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.paint();
      });
  }
  scheduleStraighten() {
    clearTimeout(this.holdTimer);
    if (this.mode !== "pen" || !this.current) return;
    this.holdTimer = setTimeout(() => {
      if (!this.current || this.pointer == null) return;
      const first = this.current.points[0], last = this.current.points.at(-1);
      if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 12) return;
      this.current.points = [first, last];
      this.straight = true;
      this.paint();
    }, 600);
  }
  erase(point) {
    const kept = this.strokes.filter(
      (stroke) =>
        !stroke.points.some(
          (p, i) =>
            distance(point, p, stroke.points[Math.max(0, i - 1)]) <
            10 + stroke.width / 2,
        ),
    );
    if (kept.length !== this.strokes.length) {
      this.strokes = kept;
      this.repaintBase();
    }
  }
  up(e, cancel = false) {
    if (this.pan?.id === e.pointerId) this.pan = null;
    if (e.pointerId !== this.pointer) return;
    clearTimeout(this.holdTimer);
    if (!cancel && this.current && this.straight && Number.isFinite(e.clientX))
      this.current.points = [this.current.points[0], this.point(e)];
    this.pointer = null;
    if (this.current && !cancel) {
      this.remember();
      this.strokes = [...this.strokes, this.current];
      this.current = null;
      this.onChange(this.strokes);
    } else if (this.mode === "eraser" && this.strokes !== this.before) {
      this.undoStack.push(this.before);
      if (this.undoStack.length > 40) this.undoStack.shift();
      this.redoStack = [];
      this.onChange(this.strokes);
    }
    this.current = null;
    this.refresh();
  }
  finish() {
    if (this.pointer != null) this.up({ pointerId: this.pointer });
  }
  undo() {
    this.finish();
    if (!this.undoStack.length) return;
    this.redoStack.push(this.strokes);
    this.strokes = this.undoStack.pop();
    this.refresh();
    this.onChange(this.strokes);
  }
  redo() {
    this.finish();
    if (!this.redoStack.length) return;
    this.undoStack.push(this.strokes);
    this.strokes = this.redoStack.pop();
    this.refresh();
    this.onChange(this.strokes);
  }
}
