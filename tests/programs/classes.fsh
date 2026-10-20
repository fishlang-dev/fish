#!/usr/bin/env fish
// mode: parse
class Counter<T> extends Base<T> implements Countable, Comparable<Counter<T>> {
  #count = 0
  label: string
  items: T[] = []
  constructor(label: string) {
    super(label)
    this.label = label
  }
  get count(): i64 {
    return this.#count
  }
  set count(value: i64) {
    this.#count = value
  }
  *[Symbol.iterator]() {
    yield* this.items
  }
  #bump() {
    this.#count++
  }
  static isCounter(value: unknown): value is Counter<unknown> {
    return #count in value
  }
}
abstract class Shape {}
let Anonymous = class {}
let Named = class Point extends mixin(A, B) { x = 0; y = 0 }
abstract class Repository<T extends { id: i64 }> {
  static #instances = 0
  static {
    Repository.#instances = 0
  }
  [key: string]: unknown
  declare readonly name: string
  protected items!: Map<i64, T>
  optional?: T
  constructor(private readonly db: Database, public label = "repo") {
    super()
  }
  abstract find(id: i64): T | undefined
  find(id: i64, strict: boolean): T
  find(id: i64, strict?: boolean): T | undefined { return undefined }
  protected async *stream(): AsyncGenerator<T> {}
  public override toString(): string { return "" }
  accessor cache = new Map()
  abstract get size(): i64
}
function overload(x: string): string
function overload(x: i64): i64
function overload(x: unknown) { return x }
