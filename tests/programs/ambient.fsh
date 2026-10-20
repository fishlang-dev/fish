// mode: parse
enum Direction { Up, Down, Left, Right, }
const enum Flags { None = 0, Read = 1 << 0, Write = 1 << 1, "Read Write" = Read | Write }
namespace Geometry.Shapes {
  const unit = 1
  namespace Inner {}
}
module Legacy { let x = 1 }
declare const VERSION: string
declare let mutable: i64
declare var process: { env: Record<string, string> }
declare function fetch(url: string): Promise<Response>
declare class Buffer { length: i64; static from(s: string): Buffer }
declare abstract class Base {}
declare enum Color { Red }
declare const enum Size { Small }
declare namespace NodeJS { interface Global {} }
declare module "fs" {
  function readFileSync(path: string): string
}
declare module "*.css";
declare global {
  interface Window { app: App }
}
declare interface Ambient {}
declare type Alias = string
let namespace = 1
let module = { exports: {} }
let declare = (x: i64) => x
declare(namespace)
module.exports = namespace
