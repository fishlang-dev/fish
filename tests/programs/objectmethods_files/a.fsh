export function use(d: Dyn<{ get(): i64 }>): i64 { return d.get(); }
