class Box { label: string; constructor(label: string) { this.label = label; } }
function helper(): i64 { return 2; }
export function fromA(): string {
  const b = new Box("a");
  return `${b.label} ${helper()}`;
}
