export enum Res { Ok(i64), Err(string) }
export function show(r: Res): string { return match (r) { case Ok(v) => "ok " + v, case Err(e) => "err " + e }; }
