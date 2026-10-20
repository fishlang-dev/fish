// mode: parse
type Getters<T> = { [K in keyof T as Prefixed<K>]: () => T[K] }
type Mutable<T> = { -readonly [K in keyof T]-?: T[K] }
type Frozen<T> = { +readonly [K in keyof T]+?: T[K]; }
type Unwrap<T> = T extends Promise<infer U> ? Unwrap<U> : T
type First<T> = T extends [infer H extends string, ...infer _] ? H : never
type Remote = import("./remote").Api<string>
type Module = typeof import("./remote")

function main() {
  type Deep<T> =
    T extends object
      ? { [K in keyof T]: Deep<T[K]> }
      : T
}
