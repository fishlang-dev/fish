// mode: parse
type Callback = (error: Error | null, value?: string) => void
type Factory = new (...args: unknown[]) => Widget
type Abstract = abstract new () => object
type Identity = <T>(x: T) => T
type Handler = (this: Window, event: Event) => boolean
type Guard = (x: unknown) => x is string
type Assert = (x: unknown) => asserts x is string
type Truthy = (x: unknown) => asserts x
type Curried = (a: i64) => (b: i64) => i64
type Is = is

function isNode(x: unknown): x is Node {}
function assertNode(x: unknown): asserts x is Node {}
function check(this: Context, value?: i64, ...rest: i64[]): this is Ready {}
function parse(): asserts {}
