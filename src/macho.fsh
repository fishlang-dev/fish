// A unit of IR as an arm64 Mach-O object: the code the native backend lowered, each global's
// bytes in the section its kind and contents call for, the constructor list as
// `__mod_init_func`, a compact unwind entry for every function in frame mode, and the LSDAs of
// those with landing pads. Every symbol starts an atom, as clang's objects do.
import { Code, Lowering, RELOC_BRANCH26, RELOC_GOT_PAGE21, RELOC_PAGE21, RELOC_TLVP_PAGE21 } from "./arm64.fsh";
import { Ir, writeWord } from "./irread.fsh";

const S_TEXT: usize = 0;
const S_CONST: usize = 1;
const S_EXCEPT: usize = 2;
const S_DCONST: usize = 3;
const S_DATA: usize = 4;
const S_INIT: usize = 5;
const S_UNWIND: usize = 6;
const SECTIONS: usize = 7;

const NAMES = ["__text", "__const", "__gcc_except_tab", "__const", "__data", "__mod_init_func", "__compact_unwind"];
const SEGMENTS = ["__TEXT", "__TEXT", "__TEXT", "__DATA", "__DATA", "__DATA", "__LD"];
const ALIGNS: i64[] = [2, 4, 2, 4, 4, 3, 3];
const FLAGS: i64[] = [0x80000400, 0, 0, 0, 0, 0x9, 0x02000000];

const UNWIND_FRAME: i64 = 0x04000000;
const UNWIND_HAS_LSDA: i64 = 0x40000000;

// The object for one unit's IR text.
export function objectOf(src: u8[]): u8[] {
  let ir = new Ir(src);
  const lines = ir.scan();
  let low = new Lowering(ir);
  low.unit(lines.defines);
  return written(low, lines.globals);
}

// Bytes, relocations and symbols per section, as they are laid out.
class Writer {
  bytes: u8[][] = [];
  // Relocations per section: offset, symbol (an Ir symbol, or past them an extra one), type,
  // pc-relative, log2 length.
  relAt: i64[][] = [];
  relSym: i64[][] = [];
  relType: i64[][] = [];
  // Where each symbol is defined: section or -1, and offset.
  symSect: i64[] = [];
  symOff: i64[] = [];
  // Symbols the backend adds: the LSDAs'.
  extraNames: u8[][] = [];
  referenced: boolean[] = [];

  constructor(symbols: usize) {
    for (let s: usize = 0; s < SECTIONS; s++) {
      this.bytes.push([]);
      this.relAt.push([]);
      this.relSym.push([]);
      this.relType.push([]);
    }
    this.symSect = new Array(symbols).fill(-1 as i64);
    this.symOff = new Array(symbols).fill(0 as i64);
    this.referenced = new Array(symbols).fill(false);
  }

  align(this: Mut<this>, s: usize, a: i64): void {
    while ((this.bytes[s]!.length as i64) % a !== 0) this.bytes[s]!.push(0);
  }

  // An 8-byte pointer to `sym` at the end of section `s`, with `addend` in place.
  pointer(this: Mut<this>, s: usize, sym: i64, addend: i64): void {
    const at = this.bytes[s]!.length as i64;
    for (let k: i64 = 0; k < 8; k++) this.bytes[s]!.push(0);
    writeWord(this.bytes[s]!, at as usize, addend, 8);
    this.relocate(s, at, sym, 0);
  }

  relocate(this: Mut<this>, s: usize, at: i64, sym: i64, type: i64): void {
    this.relAt[s]!.push(at);
    this.relSym[s]!.push(sym);
    this.relType[s]!.push(type);
    this.mark(sym);
  }

  mark(this: Mut<this>, sym: i64): void {
    while (this.referenced.length <= (sym as usize)) {
      this.referenced.push(false);
      this.symSect.push(-1);
      this.symOff.push(0);
    }
    this.referenced[sym as usize] = true;
  }
}

function written(low: Mut<Lowering>, globals: Ref<usize[]>): u8[] {
  let w = new Writer(low.ir.symName.length);
  let code: Ref<Code> = low.code;
  // Text.
  for (const word of code.words) {
    w.bytes[S_TEXT]!.push((word & 255) as u8);
    w.bytes[S_TEXT]!.push(((word >> 8) & 255) as u8);
    w.bytes[S_TEXT]!.push(((word >> 16) & 255) as u8);
    w.bytes[S_TEXT]!.push(((word >> 24) & 255) as u8);
  }
  for (let k: usize = 0; k < code.relAt.length; k++) w.relocate(S_TEXT, code.relAt[k]!, code.relSym[k]!, code.relType[k]!);
  for (let k: usize = 0; k < code.funcSym.length; k++) {
    w.symSect[code.funcSym[k]! as usize] = S_TEXT as i64;
    w.symOff[code.funcSym[k]! as usize] = code.funcStart[k]!;
  }
  // Globals.
  for (const line of globals) {
    const g = low.ir.global(line);
    if (g.skip) continue;
    if (g.ctors) {
      for (let k: usize = 0; k < g.data.relOff.length; k++) {
        // Each entry is { i32 priority, ptr function, ptr data }; the function is at 8.
        if (g.data.relOff[k]! % 24 !== 8) continue;
        w.pointer(S_INIT, g.data.relSym[k]!, 0);
      }
      continue;
    }
    const s = !g.constant ? S_DATA : g.data.relOff.length > 0 ? S_DCONST : S_CONST;
    const a = g.align > 16 ? 16 : g.align < 1 ? 1 : g.align;
    w.align(s, a);
    const at = w.bytes[s]!.length as i64;
    w.symSect[g.sym as usize] = s as i64;
    w.symOff[g.sym as usize] = at;
    for (const b of g.data.bytes) w.bytes[s]!.push(b);
    if (g.data.bytes.length === 0) w.bytes[s]!.push(0);
    for (let k: usize = 0; k < g.data.relOff.length; k++) {
      const off = at + g.data.relOff[k]!;
      writeWord(w.bytes[s]!, off as usize, g.data.relAdd[k]!, 8);
      w.relocate(s, off, g.data.relSym[k]!, 0);
    }
  }
  // LSDAs and compact unwind.
  for (const b of code.lsda) w.bytes[S_EXCEPT]!.push(b);
  const personality = low.ir.symbolNamed("__gcc_personality_v0");
  const base = low.ir.symName.length as i64;
  for (let k: usize = 0; k < code.funcSym.length; k++) {
    const at = w.bytes[S_UNWIND]!.length as i64;
    w.pointer(S_UNWIND, code.funcSym[k]!, 0);
    let entry: u8[] = new Array(24).fill(0 as u8);
    writeWord(entry, 0, code.funcLength[k]!, 4);
    const lsda = code.funcLsda[k]!;
    writeWord(entry, 4, lsda >= 0 ? UNWIND_FRAME | UNWIND_HAS_LSDA : UNWIND_FRAME, 4);
    for (const b of entry) w.bytes[S_UNWIND]!.push(b);
    if (lsda < 0) continue;
    w.relocate(S_UNWIND, at + 16, personality, 0);
    const extra = base + (w.extraNames.length as i64);
    w.extraNames.push(new TextEncoder().encode(`GCC_except_table${w.extraNames.length}`));
    w.mark(extra);
    w.symSect[extra as usize] = S_EXCEPT as i64;
    w.symOff[extra as usize] = lsda;
    w.relocate(S_UNWIND, at + 24, extra, 0);
  }
  return machO(low.ir, w);
}

// The Mach-O file: header, one segment holding every section, the build version, the symbol
// table and its dynamic part, then the sections' bytes, their relocations, symbols and names.
function machO(ir: Ref<Ir>, w: Mut<Writer>): u8[] {
  const base = ir.symName.length;
  const total = base + w.extraNames.length;
  // Symbols: locals, then defined externals, then undefined ones, the last two by name.
  let locals: usize[] = [];
  let defined: usize[] = [];
  let undefined: usize[] = [];
  for (let s: usize = 0; s < total; s++) {
    const isExtra = s >= base;
    const sect = s < w.symSect.length ? w.symSect[s]! : -1;
    if (sect >= 0) {
      if (isExtra || ir.symLocal[s]!) locals.push(s);
      else defined.push(s);
    } else if (s < w.referenced.length && w.referenced[s]!) undefined.push(s);
  }
  let names: u8[][] = [];
  for (let s: usize = 0; s < total; s++) names.push(s >= base ? w.extraNames[s - base]!.slice() : mangled(ir, s));
  defined.sort((a, b) => compareBytes(names[a]!, names[b]!));
  undefined.sort((a, b) => compareBytes(names[a]!, names[b]!));
  let order: usize[] = [];
  for (const s of locals) order.push(s);
  for (const s of defined) order.push(s);
  for (const s of undefined) order.push(s);
  let index: i64[] = new Array(total).fill(-1 as i64);
  for (let k: usize = 0; k < order.length; k++) index[order[k]!] = k as i64;

  // Section addresses and file offsets.
  const commands = 72 + 80 * (SECTIONS as i64) + 24 + 24 + 80;
  let addr: i64[] = [];
  let at: i64 = 0;
  for (let s: usize = 0; s < SECTIONS; s++) {
    const a: i64 = 1 << ALIGNS[s]!;
    at = (at + a - 1) / a * a;
    addr.push(at);
    at += w.bytes[s]!.length as i64;
  }
  const dataStart = 32 + commands;
  const segmentSize = at;
  let relocStart = (dataStart + segmentSize + 7) / 8 * 8;
  let relOffsets: i64[] = [];
  for (let s: usize = 0; s < SECTIONS; s++) {
    relOffsets.push(relocStart);
    relocStart += (w.relAt[s]!.length as i64) * 8;
  }
  const symStart = relocStart;
  const strStart = symStart + (order.length as i64) * 16;
  let strtab: u8[] = [0];
  let strx: i64[] = [];
  for (const s of order) {
    strx.push(strtab.length as i64);
    for (const b of names[s]!) strtab.push(b);
    strtab.push(0);
  }
  while (strtab.length % 8 !== 0) strtab.push(0);

  let out: u8[] = [];
  // mach_header_64
  u32(out, 0xfeedfacf);
  u32(out, 0x0100000c);
  u32(out, 0);
  u32(out, 1);
  u32(out, 4);
  u32(out, commands);
  u32(out, 0x2000);
  u32(out, 0);
  // LC_SEGMENT_64
  u32(out, 0x19);
  u32(out, 72 + 80 * (SECTIONS as i64));
  fixed(out, "", 16);
  u64(out, 0);
  u64(out, segmentSize);
  u64(out, dataStart);
  u64(out, segmentSize);
  u32(out, 7);
  u32(out, 7);
  u32(out, SECTIONS as i64);
  u32(out, 0);
  for (let s: usize = 0; s < SECTIONS; s++) {
    fixed(out, NAMES[s]!, 16);
    fixed(out, SEGMENTS[s]!, 16);
    u64(out, addr[s]!);
    u64(out, w.bytes[s]!.length as i64);
    u32(out, dataStart + addr[s]!);
    u32(out, ALIGNS[s]!);
    u32(out, w.relAt[s]!.length > 0 ? relOffsets[s]! : 0);
    u32(out, w.relAt[s]!.length as i64);
    u32(out, FLAGS[s]!);
    u32(out, 0);
    u32(out, 0);
    u32(out, 0);
  }
  // LC_BUILD_VERSION: macOS 11.0.
  u32(out, 0x32);
  u32(out, 24);
  u32(out, 1);
  u32(out, 0x000b0000);
  u32(out, 0);
  u32(out, 0);
  // LC_SYMTAB
  u32(out, 0x2);
  u32(out, 24);
  u32(out, symStart);
  u32(out, order.length as i64);
  u32(out, strStart);
  u32(out, strtab.length as i64);
  // LC_DYSYMTAB
  u32(out, 0xb);
  u32(out, 80);
  u32(out, 0);
  u32(out, locals.length as i64);
  u32(out, locals.length as i64);
  u32(out, defined.length as i64);
  u32(out, (locals.length + defined.length) as i64);
  u32(out, undefined.length as i64);
  for (let k = 0; k < 12; k++) u32(out, 0);
  // Section contents.
  for (let s: usize = 0; s < SECTIONS; s++) {
    while ((out.length as i64) < dataStart + addr[s]!) out.push(0);
    for (const b of w.bytes[s]!) out.push(b);
  }
  while ((out.length as i64) < relOffsets[0]!) out.push(0);
  // Relocations.
  for (let s: usize = 0; s < SECTIONS; s++) {
    for (let k: usize = 0; k < w.relAt[s]!.length; k++) {
      const type = w.relType[s]![k]!;
      const pcrel: i64 = type === RELOC_BRANCH26 || type === RELOC_PAGE21 || type === RELOC_GOT_PAGE21 || type === RELOC_TLVP_PAGE21 ? 1 : 0;
      const length: i64 = type === 0 ? 3 : 2;
      u32(out, w.relAt[s]![k]!);
      u32(out, index[w.relSym[s]![k]! as usize]! | (pcrel << 24) | (length << 25) | (1 << 27) | (type << 28));
    }
  }
  // Symbols.
  for (let k: usize = 0; k < order.length; k++) {
    const s = order[k]!;
    const sect = s < w.symSect.length ? w.symSect[s]! : -1;
    u32(out, strx[k]!);
    if (sect >= 0) {
      const local = s >= base || ir.symLocal[s]!;
      out.push((local ? 0x0e : 0x0f) as u8);
      out.push((sect + 1) as u8);
      out.push(0);
      out.push(0);
      u64(out, addr[sect as usize]! + w.symOff[s]!);
    } else {
      out.push(0x01);
      out.push(0);
      out.push(0);
      out.push(0);
      u64(out, 0);
    }
  }
  for (const b of strtab) out.push(b);
  return out;
}

// A symbol's Mach-O name: C's leading underscore, or `l_` for a private one.
function mangled(ir: Ref<Ir>, s: usize): u8[] {
  let out: u8[] = [];
  if (ir.symPrivate[s]!) out.push(108);
  out.push(95);
  for (const b of ir.symName[s]!) out.push(b);
  return out;
}

function compareBytes(a: Ref<u8[]>, b: Ref<u8[]>): i64 {
  const n = a.length < b.length ? a.length : b.length;
  for (let i: usize = 0; i < n; i++) if (a[i]! !== b[i]!) return (a[i]! as i64) - (b[i]! as i64);
  return (a.length as i64) - (b.length as i64);
}

function u32(out: Mut<u8[]>, v: i64): void {
  out.push((v & 255) as u8);
  out.push(((v >> 8) & 255) as u8);
  out.push(((v >> 16) & 255) as u8);
  out.push(((v >> 24) & 255) as u8);
}

function u64(out: Mut<u8[]>, v: i64): void {
  u32(out, v & 0xffffffff);
  u32(out, (v >> 32) & 0xffffffff);
}

function fixed(out: Mut<u8[]>, text: string, n: usize): void {
  const bytes = new TextEncoder().encode(text);
  for (let i: usize = 0; i < n; i++) out.push(i < bytes.length ? bytes[i]! : 0);
}
