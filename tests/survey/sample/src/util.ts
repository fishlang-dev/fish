export function helper(a: number = 1, ...more: number[]): [number, number] {
  let x, y;
  x = a; y = more.length;
  Object.defineProperty(globalThis, "z", { value: 1 });
  return [x, y];
}
