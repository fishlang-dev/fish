// The LLVM IR text fishc writes, read from bytes for the native backend: types laid out as LLVM
// lays them out on arm64, symbols, global initializers as bytes with the pointers in them, and one
// function at a time as arrays of instructions and operands. It reads only the forms codegen emits
// and refuses anything else, so a unit it can't read goes to clang instead.

// Type ids below `FIRST_TYPE` are the primitives.
export const T_VOID: i64 = 0;
export const T_I1: i64 = 1;
export const T_I8: i64 = 2;
export const T_I16: i64 = 3;
export const T_I32: i64 = 4;
export const T_I64: i64 = 5;
export const T_I128: i64 = 6;
export const T_FLOAT: i64 = 7;
export const T_DOUBLE: i64 = 8;
export const T_PTR: i64 = 9;
export const T_LABEL: i64 = 10;
const FIRST_TYPE: i64 = 11;

// Type kinds.
export const K_VOID: i64 = 0;
export const K_INT: i64 = 1;
export const K_FLOAT: i64 = 2;
export const K_DOUBLE: i64 = 3;
export const K_PTR: i64 = 4;
export const K_STRUCT: i64 = 5;
export const K_ARRAY: i64 = 6;
export const K_LABEL: i64 = 7;

// Operand kinds: a function's own value, an integer (a float's bits, an i128's low word with its
// high word in `ox`), a symbol's address plus `ox`, a constant aggregate's blob, zero (null,
// undef, poison, zeroinitializer) and a block.
export const O_LOCAL: i64 = 0;
export const O_INT: i64 = 1;
export const O_SYM: i64 = 2;
export const O_BLOB: i64 = 3;
export const O_ZERO: i64 = 4;
export const O_LABEL: i64 = 5;

// Opcodes.
export const I_ALLOCA: i64 = 1;
export const I_LOAD: i64 = 2;
export const I_STORE: i64 = 3;
export const I_GEP: i64 = 4;
export const I_EXTRACT: i64 = 5;
export const I_INSERT: i64 = 6;
export const I_BINARY: i64 = 7;
export const I_ICMP: i64 = 8;
export const I_FCMP: i64 = 9;
export const I_CAST: i64 = 10;
export const I_SELECT: i64 = 11;
export const I_PHI: i64 = 12;
export const I_CALL: i64 = 13;
export const I_INVOKE: i64 = 14;
export const I_BR: i64 = 15;
export const I_CONDBR: i64 = 16;
export const I_SWITCH: i64 = 17;
export const I_RET: i64 = 18;
export const I_UNREACHABLE: i64 = 19;
export const I_LANDINGPAD: i64 = 20;
export const I_RESUME: i64 = 21;
export const I_RMW: i64 = 22;
export const I_CMPXCHG: i64 = 23;
export const I_FENCE: i64 = 24;
export const I_FNEG: i64 = 25;

// Binary operators, in `iaux`.
export const B_ADD: i64 = 1;
export const B_SUB: i64 = 2;
export const B_MUL: i64 = 3;
export const B_SDIV: i64 = 4;
export const B_UDIV: i64 = 5;
export const B_SREM: i64 = 6;
export const B_UREM: i64 = 7;
export const B_SHL: i64 = 8;
export const B_LSHR: i64 = 9;
export const B_ASHR: i64 = 10;
export const B_AND: i64 = 11;
export const B_OR: i64 = 12;
export const B_XOR: i64 = 13;
export const B_FADD: i64 = 14;
export const B_FSUB: i64 = 15;
export const B_FMUL: i64 = 16;
export const B_FDIV: i64 = 17;
export const B_FREM: i64 = 18;

// Casts, in `iaux`.
export const C_TRUNC: i64 = 1;
export const C_ZEXT: i64 = 2;
export const C_SEXT: i64 = 3;
export const C_BITCAST: i64 = 4;
export const C_FPTOSI: i64 = 5;
export const C_FPTOUI: i64 = 6;
export const C_SITOFP: i64 = 7;
export const C_UITOFP: i64 = 8;
export const C_FPEXT: i64 = 9;
export const C_FPTRUNC: i64 = 10;

// Comparison predicates, in `iaux`: icmp's then fcmp's.
export const P_EQ: i64 = 1;
export const P_NE: i64 = 2;
export const P_UGT: i64 = 3;
export const P_UGE: i64 = 4;
export const P_ULT: i64 = 5;
export const P_ULE: i64 = 6;
export const P_SGT: i64 = 7;
export const P_SGE: i64 = 8;
export const P_SLT: i64 = 9;
export const P_SLE: i64 = 10;
export const F_FALSE: i64 = 20;
export const F_OEQ: i64 = 21;
export const F_OGT: i64 = 22;
export const F_OGE: i64 = 23;
export const F_OLT: i64 = 24;
export const F_OLE: i64 = 25;
export const F_ONE: i64 = 26;
export const F_ORD: i64 = 27;
export const F_UEQ: i64 = 28;
export const F_UGT: i64 = 29;
export const F_UGE: i64 = 30;
export const F_ULT: i64 = 31;
export const F_ULE: i64 = 32;
export const F_UNE: i64 = 33;
export const F_UNO: i64 = 34;
export const F_TRUE: i64 = 35;

// atomicrmw operations, in `iaux`.
export const R_XCHG: i64 = 1;
export const R_ADD: i64 = 2;
export const R_SUB: i64 = 3;
export const R_AND: i64 = 4;
export const R_OR: i64 = 5;
export const R_XOR: i64 = 6;
export const R_NAND: i64 = 7;
export const R_MAX: i64 = 8;
export const R_MIN: i64 = 9;
export const R_UMAX: i64 = 10;
export const R_UMIN: i64 = 11;

// Value kinds.
export const V_PLAIN: i64 = 0;
export const V_ALLOCA: i64 = 1;
export const V_PARAM: i64 = 2;

// A hash table keyed by byte ranges of one buffer, so names are looked up without making strings.
export class ByteMap {
  keyStart: i64[] = [];
  keyLen: i64[] = [];
  vals: i64[] = [];
  used: usize = 0;
  mask: usize = 0;

  constructor(capacity: usize) {
    let size: usize = 16;
    while (size < capacity * 2) size *= 2;
    this.keyStart = new Array(size).fill(-1 as i64);
    this.keyLen = new Array(size).fill(0 as i64);
    this.vals = new Array(size).fill(0 as i64);
    this.mask = size - 1;
  }

  // The value for `src[start..start+len)`, or -1.
  get(src: Ref<u8[]>, start: usize, len: usize): i64 {
    let at = hashOf(src, start, len) & this.mask;
    while (true) {
      const k = this.keyStart[at]!;
      if (k < 0) return -1;
      if ((this.keyLen[at]! as usize) === len && same(src, k as usize, start, len)) return this.vals[at]!;
      at = (at + 1) & this.mask;
    }
    return -1;
  }

  set(this: Mut<this>, src: Ref<u8[]>, start: usize, len: usize, value: i64): void {
    if ((this.used + 1) * 2 > this.mask + 1) this.grow(src);
    let at = hashOf(src, start, len) & this.mask;
    while (true) {
      const k = this.keyStart[at]!;
      if (k < 0) {
        this.keyStart[at] = start as i64;
        this.keyLen[at] = len as i64;
        this.vals[at] = value;
        this.used++;
        return;
      }
      if ((this.keyLen[at]! as usize) === len && same(src, k as usize, start, len)) {
        this.vals[at] = value;
        return;
      }
      at = (at + 1) & this.mask;
    }
  }

  private grow(this: Mut<this>, src: Ref<u8[]>): void {
    const starts = this.keyStart.slice();
    const lens = this.keyLen.slice();
    const vals = this.vals.slice();
    const size = (this.mask + 1) * 2;
    this.keyStart = new Array(size).fill(-1 as i64);
    this.keyLen = new Array(size).fill(0 as i64);
    this.vals = new Array(size).fill(0 as i64);
    this.mask = size - 1;
    this.used = 0;
    for (let i: usize = 0; i < starts.length; i++) if (starts[i]! >= 0) this.set(src, starts[i]! as usize, lens[i]! as usize, vals[i]!);
  }
}

function hashOf(src: Ref<u8[]>, start: usize, len: usize): usize {
  let h: u64 = 1469598103934665603;
  for (let i = start; i < start + len; i++) h = (h ^ (src[i]! as u64)).wrappingMul(1099511628211);
  return (h >> 7) as usize;
}

function same(src: Ref<u8[]>, a: usize, b: usize, len: usize): boolean {
  for (let i: usize = 0; i < len; i++) if (src[a + i]! !== src[b + i]!) return false;
  return true;
}

// Stops the backend with why it can't read or lower the unit. The build sends the units to clang.
export function refuse(message: string): never {
  console.error(`fishc native-object: ${message}`);
  return process.exit(3);
}

const SPACE: u8 = 32;
const NL: u8 = 10;
const QUOTE: u8 = 34;
const COMMA: u8 = 44;
const PERCENT: u8 = 37;
const AT: u8 = 64;

// One function as read: blocks of instructions, each with its operands, and its values' types.
export class Func {
  // Instructions: opcode, type, result value or -1, a sub-kind, first operand and operand count.
  iop: i64[] = [];
  ity: i64[] = [];
  ires: i64[] = [];
  iaux: i64[] = [];
  ifirst: i64[] = [];
  icount: i64[] = [];
  // A second type: a load's or GEP's source element, an alloca's type, a call's fixed arguments.
  iaux2: i64[] = [];
  // Operands: kind, type, value, extra.
  ok: i64[] = [];
  ot: i64[] = [];
  ov: i64[] = [];
  ox: i64[] = [];
  // Blocks: first instruction and count, and whether a block was seen as well as named.
  bfirst: i64[] = [];
  bcount: i64[] = [];
  // Values: type and kind.
  vty: i64[] = [];
  vkind: i64[] = [];
  params: i64[] = [];
  returns: i64 = T_VOID;
  symbol: i64 = -1;
  hasLandingPads: boolean = false;
  // Constant aggregates used as operands: their bytes and the symbols in them.
  blobFirst: i64[] = [];
  blobLen: i64[] = [];
  blobData: u8[] = [];
  blobRelFirst: i64[] = [];
  blobRelCount: i64[] = [];
  relOff: i64[] = [];
  relSym: i64[] = [];
  relAdd: i64[] = [];
}

// A global's initializer: its bytes and the symbols at offsets in it.
export class Data {
  bytes: u8[] = [];
  relOff: i64[] = [];
  relSym: i64[] = [];
  relAdd: i64[] = [];
}

export class Ir {
  src: u8[];
  pos: usize = 0;
  // Types.
  tk: i64[] = [];
  tsize: i64[] = [];
  talign: i64[] = [];
  tbits: i64[] = [];
  telem: i64[] = [];
  tfirst: i64[] = [];
  tcount: i64[] = [];
  tfields: i64[] = [];
  toffs: i64[] = [];
  typeText: ByteMap;
  namedAt: ByteMap;
  namedId: ByteMap;
  // Symbols: name bytes, whether defined here, thread-local, local to the object, and private.
  syms: ByteMap;
  symName: u8[][] = [];
  symDefined: boolean[] = [];
  symTls: boolean[] = [];
  symLocal: boolean[] = [];
  symPrivate: boolean[] = [];
  // Symbols the backend names itself, such as `memcpy`, once looked up.
  backendNames: Map<string, i64> = new Map<string, i64>();
  // The current function's names.
  locals: ByteMap;
  labels: ByteMap;
  f: Func = new Func();

  constructor(src: u8[]) {
    this.src = src;
    this.typeText = new ByteMap(1024);
    this.namedAt = new ByteMap(256);
    this.namedId = new ByteMap(256);
    this.syms = new ByteMap(4096);
    this.locals = new ByteMap(64);
    this.labels = new ByteMap(64);
    const sizes: i64[] = [0, 1, 1, 2, 4, 8, 16, 4, 8, 8, 0];
    const kinds: i64[] = [K_VOID, K_INT, K_INT, K_INT, K_INT, K_INT, K_INT, K_FLOAT, K_DOUBLE, K_PTR, K_LABEL];
    const bits: i64[] = [0, 1, 8, 16, 32, 64, 128, 32, 64, 64, 0];
    for (let i: usize = 0; i < sizes.length; i++) {
      this.tk.push(kinds[i]!);
      this.tsize.push(sizes[i]!);
      this.talign.push(sizes[i]! === 0 ? 1 : sizes[i]!);
      this.tbits.push(bits[i]!);
      this.telem.push(-1);
      this.tfirst.push(0);
      this.tcount.push(0);
    }
  }

  // ---- bytes

  at(): u8 {
    return this.pos < this.src.length ? this.src[this.pos]! : 0;
  }

  spaces(this: Mut<this>): void {
    while (this.pos < this.src.length && this.src[this.pos]! === SPACE) this.pos++;
  }

  // Whether the text at the cursor is `word` followed by a non-word byte; consumes it if so.
  eat(this: Mut<this>, word: string): boolean {
    this.spaces();
    const n = word.length;
    for (let i: usize = 0; i < n; i++) {
      if (this.pos + i >= this.src.length || (this.src[this.pos + i]! as i64) !== (word.charCodeAt(i) as i64)) return false;
    }
    const next = this.pos + n < this.src.length ? this.src[this.pos + n]! : 0;
    if (isWord(next) && isWord(word.charCodeAt(n - 1) as u8)) return false;
    this.pos += n;
    return true;
  }

  expect(this: Mut<this>, word: string): void {
    if (!this.eat(word)) this.fail(`expected '${word}'`);
  }

  fail(message: string): never {
    let end = this.pos;
    while (end < this.src.length && this.src[end]! !== NL && end < this.pos + 80) end++;
    let start = this.pos;
    while (start > 0 && this.src[start - 1]! !== NL && this.pos - start < 80) start--;
    return refuse(`${message} at '${new TextDecoder().decode(this.src.slice(start as i64, end as i64))}'`);
  }

  // A word: letters, digits, `.`, `_`, `$`, `-`.
  word(this: Mut<this>): usize {
    this.spaces();
    const start = this.pos;
    while (this.pos < this.src.length && isWord(this.src[this.pos]!)) this.pos++;
    return this.pos - start;
  }

  // A name after its sigil: `"..."` or a word. Gives its start; its length is `pos - start`.
  name(this: Mut<this>): usize {
    const start = this.pos;
    if (this.at() === QUOTE) {
      this.pos++;
      while (this.pos < this.src.length && this.src[this.pos]! !== QUOTE) this.pos++;
      this.pos++;
    } else {
      while (this.pos < this.src.length && isWord(this.src[this.pos]!)) this.pos++;
    }
    return start;
  }

  integer(this: Mut<this>): i64 {
    this.spaces();
    let negative = false;
    if (this.at() === 45) {
      negative = true;
      this.pos++;
    }
    let v: u64 = 0;
    let any = false;
    while (this.pos < this.src.length && this.src[this.pos]! >= 48 && this.src[this.pos]! <= 57) {
      v = v * 10 + ((this.src[this.pos]! - 48) as u64);
      this.pos++;
      any = true;
    }
    if (!any) this.fail("expected an integer");
    const s = v as i64;
    return negative ? s.wrappingNeg() : s;
  }

  // A decimal i128 constant as its two words.
  wide(this: Mut<this>): i64[] {
    this.spaces();
    let negative = false;
    if (this.at() === 45) {
      negative = true;
      this.pos++;
    }
    let lo: u64 = 0;
    let hi: u64 = 0;
    while (this.pos < this.src.length && this.src[this.pos]! >= 48 && this.src[this.pos]! <= 57) {
      const d = (this.src[this.pos]! - 48) as u64;
      // (hi:lo) * 10 + d, in 32-bit pieces so nothing overflows.
      const l0 = lo & 0xffffffff;
      const l1 = lo >> 32;
      const p0 = l0 * 10 + d;
      const p1 = l1 * 10 + (p0 >> 32);
      lo = (p0 & 0xffffffff) | ((p1 & 0xffffffff) << 32);
      hi = hi.wrappingMul(10).wrappingAdd(p1 >> 32);
      this.pos++;
    }
    if (negative) {
      lo = (~lo).wrappingAdd(1);
      hi = ~hi;
      if (lo === 0) hi = hi.wrappingAdd(1);
    }
    return [lo as i64, hi as i64];
  }

  // The start of the next line.
  skipLine(this: Mut<this>): void {
    while (this.pos < this.src.length && this.src[this.pos]! !== NL) this.pos++;
    if (this.pos < this.src.length) this.pos++;
  }

  // ---- types

  newType(this: Mut<this>, kind: i64, size: i64, align: i64): i64 {
    this.tk.push(kind);
    this.tsize.push(size);
    this.talign.push(align);
    this.tbits.push(0);
    this.telem.push(-1);
    this.tfirst.push(0);
    this.tcount.push(0);
    return (this.tk.length - 1) as i64;
  }

  type(this: Mut<this>): i64 {
    this.spaces();
    const c = this.at();
    const start = this.pos;
    if (c === 123 || c === 91 || c === 60) {
      const marks = [this.tk.length, this.tfields.length];
      const t = c === 123 ? this.structType(false) : c === 91 ? this.arrayType() : this.packedType();
      const known = this.typeText.get(this.src, start, this.pos - start);
      if (known >= 0) {
        while (this.tk.length > marks[0]!) {
          this.tk.pop();
          this.tsize.pop();
          this.talign.pop();
          this.tbits.pop();
          this.telem.pop();
          this.tfirst.pop();
          this.tcount.pop();
        }
        while (this.tfields.length > marks[1]!) {
          this.tfields.pop();
          this.toffs.pop();
        }
        return known;
      }
      this.typeText.set(this.src, start, this.pos - start, t);
      return t;
    }
    if (c === PERCENT) {
      this.pos++;
      const at = this.name();
      return this.named(at, this.pos - at);
    }
    const n = this.word();
    const w: Ref<u8[]> = this.src;
    if (n === 3 && w[start]! === 112 && w[start + 1]! === 116 && w[start + 2]! === 114) return T_PTR;
    if (w[start]! === 105 && n >= 2) {
      let bits: i64 = 0;
      for (let i = start + 1; i < start + n; i++) bits = bits * 10 + ((w[i]! - 48) as i64);
      if (bits === 1) return T_I1;
      if (bits === 8) return T_I8;
      if (bits === 16) return T_I16;
      if (bits === 32) return T_I32;
      if (bits === 64) return T_I64;
      if (bits === 128) return T_I128;
      this.fail(`i${bits} has no layout here`);
    }
    if (n === 4 && w[start]! === 118) return T_VOID;
    if (n === 6 && w[start]! === 100) return T_DOUBLE;
    if (n === 5 && w[start]! === 102) return T_FLOAT;
    if (n === 5 && w[start]! === 108) return T_LABEL;
    this.pos = start;
    return this.fail("expected a type");
  }

  private structType(this: Mut<this>, packed: boolean): i64 {
    this.pos++;
    let members: i64[] = [];
    this.spaces();
    if (this.at() !== 125) {
      while (true) {
        members.push(this.type());
        this.spaces();
        if (this.at() === COMMA) {
          this.pos++;
          continue;
        }
        break;
      }
    }
    this.spaces();
    if (this.at() !== 125) this.fail("expected '}'");
    this.pos++;
    return this.layout(members, packed);
  }

  private packedType(this: Mut<this>): i64 {
    this.pos++;
    this.spaces();
    if (this.at() !== 123) this.fail("expected '<{'");
    const t = this.structType(true);
    this.spaces();
    if (this.at() !== 62) this.fail("expected '}>'");
    this.pos++;
    return t;
  }

  layout(this: Mut<this>, members: Ref<i64[]>, packed: boolean): i64 {
    let offset: i64 = 0;
    let align: i64 = 1;
    let offs: i64[] = [];
    for (const m of members) {
      const a = packed ? 1 : this.talign[m as usize]!;
      offset = (offset + a - 1) / a * a;
      offs.push(offset);
      offset += this.tsize[m as usize]!;
      if (a > align) align = a;
    }
    const size = (offset + align - 1) / align * align;
    const t = this.newType(K_STRUCT, size, align);
    this.tfirst[t as usize] = this.tfields.length as i64;
    this.tcount[t as usize] = members.length as i64;
    for (let i: usize = 0; i < members.length; i++) {
      this.tfields.push(members[i]!);
      this.toffs.push(offs[i]!);
    }
    return t;
  }

  private arrayType(this: Mut<this>): i64 {
    this.pos++;
    const n = this.integer();
    this.expect("x");
    const elem = this.type();
    this.spaces();
    if (this.at() !== 93) this.fail("expected ']'");
    this.pos++;
    const t = this.newType(K_ARRAY, n * this.tsize[elem as usize]!, this.talign[elem as usize]!);
    this.tbits[t as usize] = n;
    this.telem[t as usize] = elem;
    return t;
  }

  // A named struct, laid out the first time it is asked for from its `type` line.
  private named(this: Mut<this>, at: usize, len: usize): i64 {
    const known = this.namedId.get(this.src, at, len);
    if (known >= 0) return known;
    const line = this.namedAt.get(this.src, at, len);
    if (line < 0) this.fail("a named type with no definition");
    const back = this.pos;
    this.pos = line as usize;
    this.spaces();
    if (this.eat("opaque")) this.fail("an opaque type");
    const t = this.type();
    this.pos = back;
    this.namedId.set(this.src, at, len, t);
    return t;
  }

  fieldType(t: i64, i: i64): i64 {
    if (this.tk[t as usize]! === K_ARRAY) return this.telem[t as usize]!;
    return this.tfields[(this.tfirst[t as usize]! + i) as usize]!;
  }

  fieldOffset(t: i64, i: i64): i64 {
    if (this.tk[t as usize]! === K_ARRAY) return i * this.tsize[this.telem[t as usize]! as usize]!;
    return this.toffs[(this.tfirst[t as usize]! + i) as usize]!;
  }

  isAggregate(t: i64): boolean {
    const k = this.tk[t as usize]!;
    return k === K_STRUCT || k === K_ARRAY;
  }

  // ---- symbols

  symbolAt(this: Mut<this>, start: usize, len: usize): i64 {
    const known = this.syms.get(this.src, start, len);
    if (known >= 0) return known;
    const id = this.symName.length as i64;
    this.syms.set(this.src, start, len, id);
    this.symName.push(decodedName(this.src, start, len));
    this.symDefined.push(false);
    this.symTls.push(false);
    this.symLocal.push(false);
    this.symPrivate.push(false);
    return id;
  }

  // A symbol named by text the backend makes, such as `memcpy`.
  symbolNamed(this: Mut<this>, name: string): i64 {
    const known = this.backendNames.get(name);
    if (known !== undefined) return known;
    const bytes = new TextEncoder().encode(name);
    for (let i: usize = 0; i < this.symName.length; i++) {
      const n: Ref<u8[]> = this.symName[i]!;
      if (n.length === bytes.length && sameBytes(n, bytes)) {
        this.backendNames.set(name, i as i64);
        return i as i64;
      }
    }
    this.backendNames.set(name, this.symName.length as i64);
    this.symName.push(bytes);
    this.symDefined.push(false);
    this.symTls.push(false);
    this.symLocal.push(false);
    this.symPrivate.push(false);
    return (this.symName.length - 1) as i64;
  }

  // ---- the module's lines

  // Reads every named type's place and every symbol's linkage, so functions read in any order can
  // be lowered as they come. Gives the starts of the `define` and global lines, in order.
  scan(this: Mut<this>): { defines: usize[]; globals: usize[] } {
    let defines: usize[] = [];
    let globals: usize[] = [];
    this.pos = 0;
    while (this.pos < this.src.length) {
      const c = this.at();
      const line = this.pos;
      if (c === PERCENT) {
        this.pos++;
        const at = this.name();
        const len = this.pos - at;
        this.expect("=");
        this.expect("type");
        this.namedAt.set(this.src, at, len, this.pos as i64);
        this.skipLine();
      } else if (c === AT) {
        this.pos++;
        const at = this.name();
        const s = this.symbolAt(at, this.pos - at);
        this.expect("=");
        let external = false;
        while (true) {
          if (this.eat("external")) external = true;
          else if (this.eat("internal")) this.symLocal[s as usize] = true;
          else if (this.eat("private")) {
            this.symLocal[s as usize] = true;
            this.symPrivate[s as usize] = true;
          } else if (this.eat("thread_local")) this.symTls[s as usize] = true;
          else if (this.eat("unnamed_addr") || this.eat("local_unnamed_addr") || this.eat("appending") || this.eat("dso_local") || this.eat("hidden") || this.eat("weak") || this.eat("linkonce_odr")) continue;
          else break;
        }
        if (!external) this.symDefined[s as usize] = true;
        globals.push(line);
        this.skipLine();
      } else if (c === 100 && this.eat("define")) {
        const s = this.defineSymbol();
        this.symDefined[s as usize] = true;
        defines.push(line);
        while (this.pos < this.src.length) {
          this.skipLine();
          if (this.at() === 125) break;
        }
        this.skipLine();
      } else {
        this.skipLine();
      }
    }
    return { defines, globals };
  }

  // The symbol a `define` line names, read from after `define`, marking it local when internal.
  private defineSymbol(this: Mut<this>): i64 {
    let local = false;
    while (true) {
      if (this.eat("internal") || this.eat("private")) local = true;
      else if (this.eat("dso_local") || this.eat("hidden") || this.eat("noundef") || this.eat("zeroext") || this.eat("signext") || this.eat("noalias") || this.eat("nonnull")) continue;
      else break;
    }
    this.type();
    this.spaces();
    if (this.at() !== AT) this.fail("expected a function name");
    this.pos++;
    const at = this.name();
    const s = this.symbolAt(at, this.pos - at);
    if (local) this.symLocal[s as usize] = true;
    return s;
  }

  // ---- global initializers

  // A global's line, from its start: its symbol, its type, whether it is constant, and its bytes.
  // External globals and `llvm.` globals other than the constructor list give no data.
  global(this: Mut<this>, line: usize): { sym: i64; constant: boolean; data: Data; ctors: boolean; skip: boolean; align: i64 } {
    this.pos = line + 1;
    const at = this.name();
    const sym = this.symbolAt(at, this.pos - at);
    let data = new Data();
    const ctors = isNamed(this.src, at, this.pos - at, "llvm.global_ctors");
    this.expect("=");
    let external = false;
    while (true) {
      if (this.eat("external")) external = true;
      else if (this.eat("internal") || this.eat("private") || this.eat("thread_local") || this.eat("unnamed_addr") || this.eat("local_unnamed_addr") || this.eat("appending") || this.eat("dso_local") || this.eat("hidden")) continue;
      else break;
    }
    if (external) return { sym, constant: false, data, ctors: false, skip: true, align: 1 };
    let constant = false;
    if (this.eat("constant")) constant = true;
    else this.expect("global");
    const t = this.type();
    data.bytes = new Array(this.tsize[t as usize]! as usize).fill(0 as u8);
    this.constantInto(t, data, 0);
    return { sym, constant, data, ctors, skip: false, align: this.talign[t as usize]! };
  }

  // A constant of type `t` written into `data` at `offset`.
  constantInto(this: Mut<this>, t: i64, data: Mut<Data>, offset: i64): void {
    this.spaces();
    if (this.eat("zeroinitializer") || this.eat("null") || this.eat("undef") || this.eat("poison")) return;
    const k = this.tk[t as usize]!;
    const c = this.at();
    if (k === K_STRUCT) {
      let packed = false;
      if (c === 60) {
        packed = true;
        this.pos++;
        this.spaces();
      }
      if (this.at() !== 123) this.fail("expected a struct constant");
      this.pos++;
      const n = this.tcount[t as usize]!;
      for (let i: i64 = 0; i < n; i++) {
        if (i > 0) this.expectByte(COMMA);
        const ft = this.type();
        this.constantInto(ft, data, offset + this.fieldOffset(t, i));
      }
      this.expectByte(125);
      if (packed) this.expectByte(62);
      return;
    }
    if (k === K_ARRAY) {
      const elem = this.telem[t as usize]!;
      if (c === 99) {
        // c"..." with \XX escapes.
        this.pos++;
        if (this.at() !== QUOTE) this.fail("expected a string constant");
        this.pos++;
        let o = offset;
        while (this.at() !== QUOTE) {
          let b = this.at();
          this.pos++;
          if (b === 92) {
            b = ((hexDigit(this.at()) << 4) | hexDigit(this.src[this.pos + 1]!)) as u8;
            this.pos += 2;
          }
          data.bytes[o as usize] = b;
          o++;
        }
        this.pos++;
        return;
      }
      this.expectByte(91);
      const n = this.tbits[t as usize]!;
      const size = this.tsize[elem as usize]!;
      for (let i: i64 = 0; i < n; i++) {
        if (i > 0) this.expectByte(COMMA);
        const et = this.type();
        this.constantInto(et, data, offset + i * size);
      }
      this.expectByte(93);
      return;
    }
    const v = this.scalarConstant(t);
    if (v.sym >= 0) {
      data.relOff.push(offset);
      data.relSym.push(v.sym);
      data.relAdd.push(v.lo);
      return;
    }
    const size = this.tsize[t as usize]!;
    writeWord(data.bytes, offset as usize, v.lo, size > 8 ? 8 : size);
    if (size > 8) writeWord(data.bytes, (offset + 8) as usize, v.hi, 8);
  }

  expectByte(this: Mut<this>, b: u8): void {
    this.spaces();
    if (this.at() !== b) this.fail(`expected '${String.fromCharCode(b as u16)}'`);
    this.pos++;
  }

  // A scalar constant: an integer's or a float's bits, or a symbol plus an addend.
  scalarConstant(this: Mut<this>, t: i64): { lo: i64; hi: i64; sym: i64 } {
    this.spaces();
    const c = this.at();
    if (c === AT) {
      this.pos++;
      const at = this.name();
      return { lo: 0, hi: 0, sym: this.symbolAt(at, this.pos - at) };
    }
    if (this.eat("true")) return { lo: 1, hi: 0, sym: -1 };
    if (this.eat("false") || this.eat("null") || this.eat("zeroinitializer") || this.eat("undef") || this.eat("poison")) return { lo: 0, hi: 0, sym: -1 };
    if (this.eat("ptrtoint") || this.eat("inttoptr") || this.eat("bitcast")) {
      this.expectByte(40);
      const from = this.type();
      const v = this.scalarConstant(from);
      this.expect("to");
      this.type();
      this.expectByte(41);
      return v;
    }
    if (this.eat("getelementptr")) return this.constantGep();
    const k = this.tk[t as usize]!;
    if (k === K_DOUBLE || k === K_FLOAT) return { lo: this.floatBits(k === K_FLOAT), hi: 0, sym: -1 };
    if (t === T_I128) {
      const w = this.wide();
      return { lo: w[0]!, hi: w[1]!, sym: -1 };
    }
    return { lo: masked(this.integer(), this.tbits[t as usize]!), hi: 0, sym: -1 };
  }

  // `getelementptr (T, ptr base, indices...)` with constant indices: a symbol plus an offset, or
  // from null, the offset alone (a type's size).
  private constantGep(this: Mut<this>): { lo: i64; hi: i64; sym: i64 } {
    this.eat("inbounds");
    this.expectByte(40);
    let t = this.type();
    this.expectByte(COMMA);
    this.type();
    const base = this.scalarConstant(T_PTR);
    let offset = base.lo;
    let first = true;
    while (true) {
      this.spaces();
      if (this.at() !== COMMA) break;
      this.pos++;
      this.type();
      const i = this.integer();
      if (first) {
        offset += i * this.tsize[t as usize]!;
        first = false;
      } else {
        offset += this.fieldOffset(t, i);
        t = this.fieldType(t, i);
      }
    }
    this.expectByte(41);
    return { lo: offset, hi: 0, sym: base.sym };
  }

  // A float constant's bits: a decimal, or LLVM's hex form, which for a float is the double's.
  floatBits(this: Mut<this>, single: boolean): i64 {
    this.spaces();
    const start = this.pos;
    if (this.at() === 48 && this.pos + 1 < this.src.length && this.src[this.pos + 1]! === 120) {
      this.pos += 2;
      let v: u64 = 0;
      while (isHex(this.at())) {
        v = (v << 4) | (hexDigit(this.at()) as u64);
        this.pos++;
      }
      const d = bitsToDouble(v as i64);
      return single ? floatBitsOf(d) : (v as i64);
    }
    while (this.pos < this.src.length && (isWord(this.at()) || this.at() === 43)) this.pos++;
    const text = new TextDecoder().decode(this.src.slice(start as i64, this.pos as i64));
    const d = parseFloat(text) ?? 0;
    return single ? floatBitsOf(d) : doubleBits(d);
  }

  // ---- functions

  // Reads the function whose `define` line starts at `line` into `f`.
  func(this: Mut<this>, line: usize): void {
    this.f = new Func();
    this.locals = new ByteMap(256);
    this.labels = new ByteMap(64);
    this.pos = line;
    this.expect("define");
    while (true) {
      if (this.eat("internal") || this.eat("private") || this.eat("dso_local") || this.eat("hidden") || this.eat("noundef") || this.eat("zeroext") || this.eat("signext") || this.eat("noalias") || this.eat("nonnull")) continue;
      break;
    }
    this.f.returns = this.type();
    this.spaces();
    this.pos++;
    const at = this.name();
    this.f.symbol = this.symbolAt(at, this.pos - at);
    this.expectByte(40);
    this.spaces();
    if (this.at() !== 41) {
      while (true) {
        const t = this.type();
        this.attributes();
        this.spaces();
        if (this.at() !== PERCENT) this.fail("expected a parameter name");
        this.pos++;
        const n = this.name();
        const v = this.local(n, this.pos - n, t);
        this.f.vkind[v as usize] = V_PARAM;
        this.f.params.push(v);
        this.spaces();
        if (this.at() === COMMA) {
          this.pos++;
          continue;
        }
        break;
      }
    }
    this.expectByte(41);
    this.skipLine();
    let block: i64 = -1;
    while (this.pos < this.src.length) {
      const c = this.at();
      if (c === 125) break;
      if (c === NL) {
        this.pos++;
        continue;
      }
      if (c !== SPACE) {
        // A block's label.
        const n = this.pos;
        while (this.at() !== 58) this.pos++;
        block = this.label(n, this.pos - n);
        this.f.bfirst[block as usize] = this.f.iop.length as i64;
        this.skipLine();
        continue;
      }
      if (block < 0) {
        block = this.newBlock();
        this.f.bfirst[block as usize] = 0;
      }
      this.instruction();
      this.f.bcount[block as usize] = (this.f.iop.length as i64) - this.f.bfirst[block as usize]!;
      this.skipLine();
    }
  }

  // Skips parameter and return attributes up to a value.
  attributes(this: Mut<this>): void {
    while (true) {
      this.spaces();
      const c = this.at();
      if (c === PERCENT || c === AT || c === COMMA || c === 41 || c === 123 || c === 91 || c === 60 || c === 45 || (c >= 48 && c <= 57) || c === 99 && this.src[this.pos + 1]! === QUOTE) return;
      const save = this.pos;
      if (this.eat("true") || this.eat("false") || this.eat("null") || this.eat("undef") || this.eat("poison") || this.eat("zeroinitializer") || this.eat("getelementptr") || this.eat("ptrtoint") || this.eat("inttoptr") || this.eat("bitcast")) {
        this.pos = save;
        return;
      }
      const n = this.word();
      if (n === 0) return;
      // `align 8`, `dereferenceable(8)`, `byval(T)`.
      if (this.at() === 40) {
        let depth = 0;
        while (true) {
          const b = this.at();
          this.pos++;
          if (b === 40) depth++;
          else if (b === 41 && --depth === 0) break;
        }
      } else if (n === 5 && isNamed(this.src, save, 5, "align")) {
        this.integer();
      }
    }
  }

  // The value a local name refers to, made the first time it is seen.
  local(this: Mut<this>, start: usize, len: usize, t: i64): i64 {
    const known = this.locals.get(this.src, start, len);
    if (known >= 0) {
      if (this.f.vty[known as usize]! < 0) this.f.vty[known as usize] = t;
      return known;
    }
    const v = this.f.vty.length as i64;
    this.locals.set(this.src, start, len, v);
    this.f.vty.push(t);
    this.f.vkind.push(V_PLAIN);
    return v;
  }

  label(this: Mut<this>, start: usize, len: usize): i64 {
    const known = this.labels.get(this.src, start, len);
    if (known >= 0) return known;
    const b = this.f.bfirst.length as i64;
    this.labels.set(this.src, start, len, b);
    this.f.bfirst.push(-1);
    this.f.bcount.push(0);
    return b;
  }

  private newBlock(this: Mut<this>): i64 {
    const b = this.f.bfirst.length as i64;
    this.f.bfirst.push(-1);
    this.f.bcount.push(0);
    return b;
  }

  // An operand of type `t`, pushed; gives its index.
  operand(this: Mut<this>, t: i64): i64 {
    this.spaces();
    const c = this.at();
    let kind = O_INT;
    let v: i64 = 0;
    let x: i64 = 0;
    if (c === PERCENT) {
      this.pos++;
      const n = this.name();
      kind = O_LOCAL;
      v = this.local(n, this.pos - n, t);
    } else if (c === 123 || c === 91 || c === 60 || (c === 99 && this.src[this.pos + 1]! === QUOTE)) {
      kind = O_BLOB;
      v = this.blob(t);
    } else if (this.eat("zeroinitializer") || this.eat("null") || this.eat("undef") || this.eat("poison") || this.eat("false")) {
      kind = O_ZERO;
    } else if (this.isAggregate(t)) {
      kind = O_BLOB;
      v = this.blob(t);
    } else {
      const s = this.scalarConstant(t);
      if (s.sym >= 0) {
        kind = O_SYM;
        v = s.sym;
        x = s.lo;
      } else {
        v = s.lo;
        x = s.hi;
        if (v === 0 && x === 0) kind = O_ZERO;
      }
    }
    this.f.ok.push(kind);
    this.f.ot.push(t);
    this.f.ov.push(v);
    this.f.ox.push(x);
    return (this.f.ok.length - 1) as i64;
  }

  // A constant aggregate as bytes and symbols; gives its blob id.
  private blob(this: Mut<this>, t: i64): i64 {
    let data = new Data();
    data.bytes = new Array(this.tsize[t as usize]! as usize).fill(0 as u8);
    this.constantInto(t, data, 0);
    const id = this.f.blobFirst.length as i64;
    this.f.blobFirst.push(this.f.blobData.length as i64);
    this.f.blobLen.push(data.bytes.length as i64);
    for (const b of data.bytes) this.f.blobData.push(b);
    this.f.blobRelFirst.push(this.f.relOff.length as i64);
    this.f.blobRelCount.push(data.relOff.length as i64);
    for (let i: usize = 0; i < data.relOff.length; i++) {
      this.f.relOff.push(data.relOff[i]!);
      this.f.relSym.push(data.relSym[i]!);
      this.f.relAdd.push(data.relAdd[i]!);
    }
    return id;
  }

  // A typed operand: `T value`.
  typed(this: Mut<this>): i64 {
    const t = this.type();
    this.attributes();
    return this.operand(t);
  }

  labelOperand(this: Mut<this>): i64 {
    this.expect("label");
    this.spaces();
    if (this.at() !== PERCENT) this.fail("expected a label");
    this.pos++;
    const n = this.name();
    const b = this.label(n, this.pos - n);
    this.f.ok.push(O_LABEL);
    this.f.ot.push(T_LABEL);
    this.f.ov.push(b);
    this.f.ox.push(0);
    return (this.f.ok.length - 1) as i64;
  }

  intOperand(this: Mut<this>, v: i64): i64 {
    this.f.ok.push(O_INT);
    this.f.ot.push(T_I64);
    this.f.ov.push(v);
    this.f.ox.push(0);
    return (this.f.ok.length - 1) as i64;
  }

  comma(this: Mut<this>): boolean {
    this.spaces();
    if (this.at() !== COMMA) return false;
    this.pos++;
    return true;
  }

  // Skips `, align N` and orderings at the end of a memory instruction.
  private tail(this: Mut<this>): void {
    while (true) {
      this.spaces();
      if (this.at() !== COMMA) return;
      const save = this.pos;
      this.pos++;
      if (this.eat("align")) {
        this.integer();
        continue;
      }
      this.pos = save;
      return;
    }
  }

  // One instruction line, from its leading spaces.
  private instruction(this: Mut<this>): void {
    this.spaces();
    let result: i64 = -1;
    let resultStart: usize = 0;
    let resultLen: usize = 0;
    if (this.at() === PERCENT) {
      this.pos++;
      resultStart = this.name();
      resultLen = this.pos - resultStart;
      this.expect("=");
    }
    const first = this.f.ok.length as i64;
    let op: i64 = 0;
    let ty: i64 = T_VOID;
    let aux: i64 = 0;
    let aux2: i64 = 0;
    this.spaces();
    if (this.eat("tail") || this.eat("musttail") || this.eat("notail")) this.spaces();
    if (this.eat("call")) {
      op = I_CALL;
      const r = this.call();
      ty = r[0]!;
      aux2 = r[1]!;
    } else if (this.eat("invoke")) {
      op = I_INVOKE;
      const r = this.call();
      ty = r[0]!;
      aux2 = r[1]!;
      this.expect("to");
      this.labelOperand();
      this.expect("unwind");
      this.labelOperand();
      this.f.hasLandingPads = true;
    } else if (this.eat("load")) {
      op = I_LOAD;
      if (this.eat("atomic")) aux = 1;
      this.eat("volatile");
      ty = this.type();
      this.expectByte(COMMA);
      this.typed();
      this.eat("seq_cst") || this.eat("acquire") || this.eat("monotonic") || this.eat("unordered");
      this.tail();
    } else if (this.eat("store")) {
      op = I_STORE;
      if (this.eat("atomic")) aux = 1;
      this.eat("volatile");
      const v = this.typed();
      ty = this.f.ot[v as usize]!;
      this.expectByte(COMMA);
      this.typed();
      this.eat("seq_cst") || this.eat("release") || this.eat("monotonic") || this.eat("unordered");
      this.tail();
    } else if (this.eat("alloca")) {
      op = I_ALLOCA;
      aux2 = this.type();
      ty = T_PTR;
      if (this.comma()) {
        if (!this.eat("align")) this.fail("a dynamic alloca");
        this.integer();
      }
    } else if (this.eat("getelementptr")) {
      op = I_GEP;
      this.eat("inbounds");
      this.eat("nuw");
      aux2 = this.type();
      ty = T_PTR;
      this.expectByte(COMMA);
      this.typed();
      while (this.comma()) this.typed();
    } else if (this.eat("extractvalue")) {
      op = I_EXTRACT;
      const v = this.typed();
      let t = this.f.ot[v as usize]!;
      while (this.comma()) {
        const i = this.integer();
        this.intOperand(i);
        t = this.fieldType(t, i);
      }
      ty = t;
    } else if (this.eat("insertvalue")) {
      op = I_INSERT;
      const v = this.typed();
      ty = this.f.ot[v as usize]!;
      this.expectByte(COMMA);
      this.typed();
      while (this.comma()) {
        const i = this.integer();
        this.intOperand(i);
      }
    } else if (this.eat("icmp")) {
      op = I_ICMP;
      aux = this.predicate();
      const t = this.type();
      this.operand(t);
      this.expectByte(COMMA);
      this.operand(t);
      ty = T_I1;
    } else if (this.eat("fcmp")) {
      op = I_FCMP;
      this.fastMath();
      aux = this.predicate();
      const t = this.type();
      this.operand(t);
      this.expectByte(COMMA);
      this.operand(t);
      ty = T_I1;
    } else if (this.eat("select")) {
      op = I_SELECT;
      this.typed();
      this.expectByte(COMMA);
      const a = this.typed();
      ty = this.f.ot[a as usize]!;
      this.expectByte(COMMA);
      this.typed();
    } else if (this.eat("phi")) {
      op = I_PHI;
      ty = this.type();
      while (true) {
        this.expectByte(91);
        this.operand(ty);
        this.expectByte(COMMA);
        this.spaces();
        this.pos++;
        const n = this.name();
        const b = this.label(n, this.pos - n);
        this.f.ok.push(O_LABEL);
        this.f.ot.push(T_LABEL);
        this.f.ov.push(b);
        this.f.ox.push(0);
        this.expectByte(93);
        if (!this.comma()) break;
      }
    } else if (this.eat("br")) {
      this.spaces();
      if (this.eat("label")) {
        op = I_BR;
        this.spaces();
        this.pos++;
        const n = this.name();
        const b = this.label(n, this.pos - n);
        this.f.ok.push(O_LABEL);
        this.f.ot.push(T_LABEL);
        this.f.ov.push(b);
        this.f.ox.push(0);
      } else {
        op = I_CONDBR;
        this.typed();
        this.expectByte(COMMA);
        this.labelOperand();
        this.expectByte(COMMA);
        this.labelOperand();
      }
    } else if (this.eat("switch")) {
      op = I_SWITCH;
      const v = this.typed();
      const t = this.f.ot[v as usize]!;
      this.expectByte(COMMA);
      this.labelOperand();
      this.expectByte(91);
      while (true) {
        this.spaces();
        if (this.at() === NL) {
          this.pos++;
          continue;
        }
        if (this.at() === 93) break;
        this.type();
        this.operand(t);
        this.expectByte(COMMA);
        this.labelOperand();
      }
      this.pos++;
    } else if (this.eat("ret")) {
      op = I_RET;
      this.spaces();
      if (!this.eat("void")) {
        const v = this.typed();
        ty = this.f.ot[v as usize]!;
      }
    } else if (this.eat("unreachable")) {
      op = I_UNREACHABLE;
    } else if (this.eat("landingpad")) {
      op = I_LANDINGPAD;
      ty = this.type();
      if (!this.eat("cleanup")) this.fail("a landing pad that catches");
    } else if (this.eat("resume")) {
      op = I_RESUME;
      this.typed();
    } else if (this.eat("atomicrmw")) {
      op = I_RMW;
      this.eat("volatile");
      aux = this.rmwOp();
      this.typed();
      this.expectByte(COMMA);
      const v = this.typed();
      ty = this.f.ot[v as usize]!;
      this.word();
    } else if (this.eat("cmpxchg")) {
      op = I_CMPXCHG;
      this.eat("weak");
      this.eat("volatile");
      this.typed();
      this.expectByte(COMMA);
      const v = this.typed();
      this.expectByte(COMMA);
      this.typed();
      this.word();
      this.word();
      const t = this.f.ot[v as usize]!;
      ty = this.layout([t, T_I1], false);
    } else if (this.eat("fence")) {
      op = I_FENCE;
      this.word();
    } else if (this.eat("fneg")) {
      op = I_FNEG;
      this.fastMath();
      const v = this.typed();
      ty = this.f.ot[v as usize]!;
    } else {
      const b = this.binaryOp();
      if (b > 0) {
        op = I_BINARY;
        aux = b;
        while (this.eat("nuw") || this.eat("nsw") || this.eat("exact") || this.eat("disjoint")) continue;
        this.fastMath();
        ty = this.type();
        this.operand(ty);
        this.expectByte(COMMA);
        this.operand(ty);
      } else {
        const k = this.castOp();
        if (k === 0) this.fail("an instruction the native backend doesn't read");
        op = I_CAST;
        aux = k;
        this.eat("nneg");
        this.eat("nuw");
        this.eat("nsw");
        this.typed();
        this.expect("to");
        ty = this.type();
      }
    }
    if (resultLen > 0) result = this.local(resultStart, resultLen, ty);
    if (result >= 0 && op === I_ALLOCA) this.f.vkind[result as usize] = V_ALLOCA;
    this.f.iop.push(op);
    this.f.ity.push(ty);
    this.f.ires.push(result);
    this.f.iaux.push(aux);
    this.f.iaux2.push(aux2);
    this.f.ifirst.push(first);
    this.f.icount.push((this.f.ok.length as i64) - first);
  }

  private fastMath(this: Mut<this>): void {
    while (this.eat("fast") || this.eat("nnan") || this.eat("ninf") || this.eat("nsz") || this.eat("arcp") || this.eat("contract") || this.eat("afn") || this.eat("reassoc")) continue;
  }

  // A call's return type and callee and arguments, pushed as operands with the callee first. Gives
  // the return type and the count of fixed parameters for a variadic callee, or -1.
  private call(this: Mut<this>): i64[] {
    while (this.eat("fastcc") || this.eat("ccc") || this.eat("noundef") || this.eat("zeroext") || this.eat("signext") || this.eat("noalias") || this.eat("nonnull")) continue;
    const ret = this.type();
    let fixed: i64 = -1;
    this.spaces();
    if (this.at() === 40) {
      // A function type: `(ptr, ...)`.
      this.pos++;
      let n: i64 = 0;
      while (true) {
        this.spaces();
        if (this.at() === 41) break;
        if (this.at() === 46) {
          this.pos += 3;
          fixed = n;
          continue;
        }
        this.type();
        n++;
        this.comma();
      }
      this.pos++;
    }
    this.operand(T_PTR);
    this.expectByte(40);
    this.spaces();
    if (this.at() !== 41) {
      while (true) {
        this.typed();
        if (!this.comma()) break;
      }
    }
    this.expectByte(41);
    // Function attributes: `#0`, `nounwind`.
    while (true) {
      this.spaces();
      if (this.at() === 35) {
        this.pos++;
        this.word();
        continue;
      }
      if (this.eat("nounwind") || this.eat("noreturn") || this.eat("cold") || this.eat("readnone") || this.eat("readonly")) continue;
      break;
    }
    return [ret, fixed];
  }

  private predicate(this: Mut<this>): i64 {
    this.spaces();
    const start = this.pos;
    const n = this.word();
    const w = new TextDecoder().decode(this.src.slice(start as i64, (start + n) as i64));
    const all = ["eq", "ne", "ugt", "uge", "ult", "ule", "sgt", "sge", "slt", "sle"];
    for (let i: usize = 0; i < all.length; i++) if (all[i]! === w) return (i as i64) + 1;
    const fl = ["false", "oeq", "ogt", "oge", "olt", "ole", "one", "ord", "ueq", "ugt", "uge", "ult", "ule", "une", "uno", "true"];
    for (let i: usize = 0; i < fl.length; i++) if (fl[i]! === w) return (i as i64) + F_FALSE;
    return this.fail("an unknown predicate");
  }

  private rmwOp(this: Mut<this>): i64 {
    const names = ["xchg", "add", "sub", "and", "or", "xor", "nand", "max", "min", "umax", "umin"];
    for (let i: usize = 0; i < names.length; i++) if (this.eat(names[i]!)) return (i as i64) + 1;
    return this.fail("an atomicrmw the native backend doesn't lower");
  }

  private binaryOp(this: Mut<this>): i64 {
    const names = ["add", "sub", "mul", "sdiv", "udiv", "srem", "urem", "shl", "lshr", "ashr", "and", "or", "xor", "fadd", "fsub", "fmul", "fdiv", "frem"];
    for (let i: usize = 0; i < names.length; i++) if (this.eat(names[i]!)) return (i as i64) + 1;
    return 0;
  }

  private castOp(this: Mut<this>): i64 {
    if (this.eat("trunc")) return C_TRUNC;
    if (this.eat("zext")) return C_ZEXT;
    if (this.eat("sext")) return C_SEXT;
    if (this.eat("bitcast") || this.eat("ptrtoint") || this.eat("inttoptr")) return C_BITCAST;
    if (this.eat("fptosi")) return C_FPTOSI;
    if (this.eat("fptoui")) return C_FPTOUI;
    if (this.eat("sitofp")) return C_SITOFP;
    if (this.eat("uitofp")) return C_UITOFP;
    if (this.eat("fpext")) return C_FPEXT;
    if (this.eat("fptrunc")) return C_FPTRUNC;
    return 0;
  }

  // Whether the symbol a call names is an `llvm.` intrinsic; the name follows.
  isIntrinsic(s: i64): boolean {
    const n: Ref<u8[]> = this.symName[s as usize]!;
    return n.length > 5 && n[0]! === 108 && n[1]! === 108 && n[2]! === 118 && n[3]! === 109 && n[4]! === 46;
  }

  symbolText(s: i64): string {
    return new TextDecoder().decode(this.symName[s as usize]!);
  }
}

function isWord(b: u8): boolean {
  return (b >= 97 && b <= 122) || (b >= 65 && b <= 90) || (b >= 48 && b <= 57) || b === 46 || b === 95 || b === 36 || b === 45;
}

function isHex(b: u8): boolean {
  return (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102);
}

function hexDigit(b: u8): i64 {
  if (b >= 48 && b <= 57) return (b - 48) as i64;
  if (b >= 65 && b <= 70) return (b - 55) as i64;
  return (b - 87) as i64;
}

function isNamed(src: Ref<u8[]>, start: usize, len: usize, name: string): boolean {
  if (len !== name.length) return false;
  for (let i: usize = 0; i < len; i++) if ((src[start + i]! as i64) !== (name.charCodeAt(i) as i64)) return false;
  return true;
}

function sameBytes(a: Ref<u8[]>, b: Ref<u8[]>): boolean {
  for (let i: usize = 0; i < a.length; i++) if (a[i]! !== b[i]!) return false;
  return true;
}

// A name's bytes without its quotes, with `\XX` escapes decoded.
function decodedName(src: Ref<u8[]>, start: usize, len: usize): u8[] {
  let out: u8[] = [];
  if (src[start]! !== QUOTE) {
    for (let i = start; i < start + len; i++) out.push(src[i]!);
    return out;
  }
  let i = start + 1;
  const end = start + len - 1;
  while (i < end) {
    const b = src[i]!;
    if (b === 92 && i + 2 < end + 1) {
      out.push(((hexDigit(src[i + 1]!) << 4) | hexDigit(src[i + 2]!)) as u8);
      i += 3;
      continue;
    }
    out.push(b);
    i++;
  }
  return out;
}

// `v` cut to its low `bits` bits, as the backend keeps narrow integers zero-extended.
export function masked(v: i64, bits: i64): i64 {
  if (bits >= 64) return v;
  if (bits === 32) return v & 0xffffffff;
  return v & ((1 << bits) - 1);
}

export function writeWord(bytes: Mut<u8[]>, at: usize, v: i64, size: i64): void {
  let x = v as u64;
  for (let i: i64 = 0; i < size; i++) {
    bytes[at + (i as usize)] = (x & 255) as u8;
    x = x >> 8;
  }
}

export function doubleBits(d: f64): i64 {
  let view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d, true);
  return view.getBigInt64(0, true) as i64;
}

function bitsToDouble(bits: i64): f64 {
  let view = new DataView(new ArrayBuffer(8));
  view.setBigInt64(0, BigInt(bits), true);
  return view.getFloat64(0, true);
}

function floatBitsOf(d: f64): i64 {
  let view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, d, true);
  return view.getUint32(0, true) as i64;
}
