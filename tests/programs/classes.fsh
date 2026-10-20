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
  isCounter(value: unknown): value is Counter<unknown> {
    return #count in value
  }
}
abstract class Shape {}
let Anonymous = class {}
let Named = class Point extends mixin(A, B) { x = 0; y = 0 }
