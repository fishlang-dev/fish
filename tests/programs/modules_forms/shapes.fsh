export enum Shape { Circle, Square }
export class Point { x: i64; y: i64; constructor(x: i64, y: i64) { this.x = x; this.y = y; } }
export interface Named { name: string }
export type Pair = { left: i64; right: i64 };
export function area(s: Shape): string { return s === Shape.Circle ? "circle" : "square"; }
