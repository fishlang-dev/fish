export class Rect {
  w: i64;
  h: i64;
  constructor(w: i64, h: i64) { this.w = w; this.h = h; }
  area(): i64 { return this.w * this.h; }
  label(): string { return "area"; }
}
