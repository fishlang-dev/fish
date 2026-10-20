// mode: parse
type Id = i64
type Pair<T extends Base = Default, const U, in V, out W> = Map<T, U>;
type out = A
type Box<out> = out

function first<T, out K extends Key>(items: List<T>): T {
  type Local = Map<string, T>
  let x: Local = 1
}
