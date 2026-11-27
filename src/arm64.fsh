// The native backend's arm64 code: each function the IR reader reads lowered naively, every value
// in a frame slot and every operation through scratch registers, with no register allocation and
// no optimization. Calls follow AAPCS64 for scalars, as Darwin lays them out; an aggregate goes by
// pointer to the caller's copy, and one returned goes through `x8`. The frame keeps `sp` fixed
// from the prologue on and saves only fp and lr, so compact unwind's frame mode describes every
// function, and each function's invokes make its LSDA.
import {
  B_ADD, B_AND, B_ASHR, B_FADD, B_FDIV, B_FMUL, B_FREM, B_FSUB, B_LSHR, B_MUL, B_OR, B_SDIV, B_SHL, B_SREM, B_SUB, B_UDIV, B_UREM, B_XOR,
  C_BITCAST, C_FPEXT, C_FPTOSI, C_FPTOUI, C_FPTRUNC, C_SEXT, C_SITOFP, C_TRUNC, C_UITOFP, C_ZEXT,
  F_FALSE, F_OEQ, F_OGE, F_OGT, F_OLE, F_OLT, F_ONE, F_ORD, F_TRUE, F_UEQ, F_UGE, F_UGT, F_ULE, F_ULT, F_UNE, F_UNO,
  I_ALLOCA, I_BINARY, I_BR, I_CALL, I_CAST, I_CMPXCHG, I_CONDBR, I_EXTRACT, I_FCMP, I_FENCE, I_FNEG, I_GEP, I_ICMP, I_INSERT, I_INVOKE, I_LANDINGPAD, I_LOAD, I_PHI, I_RESUME, I_RET, I_RMW, I_SELECT, I_STORE, I_SWITCH, I_UNREACHABLE,
  Ir, K_ARRAY, K_DOUBLE, K_FLOAT, K_INT, K_PTR, K_STRUCT, O_BLOB, O_INT, O_LABEL, O_LOCAL, O_SYM, O_ZERO,
  P_EQ, P_NE, P_SGE, P_SGT, P_SLE, P_SLT, P_UGE, P_UGT, P_ULE, P_ULT,
  R_ADD, R_AND, R_MAX, R_MIN, R_NAND, R_OR, R_SUB, R_UMAX, R_UMIN, R_XCHG, R_XOR,
  refuse, T_I1, T_I128, T_I32, T_I64, T_PTR, T_VOID, V_ALLOCA,
} from "./irread.fsh";

// Registers. 31 is sp as a base and as an add's operand, xzr elsewhere.
const X0: i64 = 0;
const X1: i64 = 1;
const X2: i64 = 2;
const X8: i64 = 8;
const X9: i64 = 9;
const X10: i64 = 10;
const X11: i64 = 11;
const X12: i64 = 12;
const X13: i64 = 13;
const X14: i64 = 14;
const X16: i64 = 16;
const X17: i64 = 17;
const FP: i64 = 29;
const LR: i64 = 30;
const SP: i64 = 31;
const ZR: i64 = 31;
const D16: i64 = 16;
const D17: i64 = 17;

// Condition codes.
const EQ: i64 = 0;
const NE: i64 = 1;
const HS: i64 = 2;
const LO: i64 = 3;
const MI: i64 = 4;
const PL: i64 = 5;
const VS: i64 = 6;
const VC: i64 = 7;
const HI: i64 = 8;
const LS: i64 = 9;
const GE: i64 = 10;
const LT: i64 = 11;
const GT: i64 = 12;
const LE: i64 = 13;

// Memory access kinds: the scaled unsigned-offset opcode, and log2 of the size.
const LDRB: i64 = 0x39400000;
const LDRH: i64 = 0x79400000;
const LDRW: i64 = 0xb9400000;
const LDRX: i64 = 0xf9400000;
const STRB: i64 = 0x39000000;
const STRH: i64 = 0x79000000;
const STRW: i64 = 0xb9000000;
const STRX: i64 = 0xf9000000;
const LDRS: i64 = 0xbd400000;
const LDRD: i64 = 0xfd400000;
const STRS: i64 = 0xbd000000;
const STRD: i64 = 0xfd000000;

// Mach-O relocation types the text uses.
export const RELOC_BRANCH26: i64 = 2;
export const RELOC_PAGE21: i64 = 3;
export const RELOC_PAGEOFF12: i64 = 4;
export const RELOC_GOT_PAGE21: i64 = 5;
export const RELOC_GOT_PAGEOFF12: i64 = 6;
export const RELOC_TLVP_PAGE21: i64 = 8;
export const RELOC_TLVP_PAGEOFF12: i64 = 9;

// What one unit's functions lowered to: code, the relocations in it, each function's place, and
// the LSDAs of those with landing pads.
export class Code {
  words: i64[] = [];
  relAt: i64[] = [];
  relSym: i64[] = [];
  relType: i64[] = [];
  funcSym: i64[] = [];
  funcStart: i64[] = [];
  funcLength: i64[] = [];
  funcLsda: i64[] = [];
  lsda: u8[] = [];
}

export class Lowering {
  ir: Ir;
  code: Code = new Code();
  // The function being lowered: each value's slot, each phi's shadow, the frame's top so far, its
  // outgoing argument area, labels and their uses, and its invokes' call sites.
  slot: i64[] = [];
  shadow: i64[] = [];
  top: i64 = 0;
  outgoing: i64 = 0;
  sret: i64 = -1;
  start: i64 = 0;
  labelAt: i64[] = [];
  fixAt: i64[] = [];
  fixLabel: i64[] = [];
  fixWide: boolean[] = [];
  siteAt: i64[] = [];
  siteLabel: i64[] = [];
  // Each block's phis: the first phi instruction and how many there are.
  phiFirst: i64[] = [];
  phiCount: i64[] = [];
  // The block being lowered, which edges leave from.
  current: i64 = -1;
  // Whether conditional branches go through a `b` so they reach past 1 MB.
  far: boolean = false;
  // The frame page x17 points at, or -1.
  page: i64 = -1;
  // The scratch area: where it starts, the next free byte, and the most any instruction used.
  scratchBase: i64 = 0;
  scratchTop: i64 = 0;
  scratchEnd: i64 = 0;

  constructor(ir: Ir) {
    this.ir = ir;
  }

  // ---- emitting

  emit(this: Mut<this>, w: i64): void {
    this.code.words.push(w);
  }

  here(): i64 {
    return this.code.words.length as i64;
  }

  reloc(this: Mut<this>, sym: i64, type: i64): void {
    this.code.relAt.push(this.here() * 4);
    this.code.relSym.push(sym);
    this.code.relType.push(type);
  }

  newLabel(this: Mut<this>): i64 {
    this.labelAt.push(-1);
    return (this.labelAt.length - 1) as i64;
  }

  bind(this: Mut<this>, l: i64): void {
    this.page = -1;
    this.labelAt[l as usize] = this.here();
  }

  // A branch to a label: `b`, or `b.cond` / `cbz` / `cbnz` with a 19-bit offset.
  branch(this: Mut<this>, w: i64, l: i64, wide: boolean): void {
    if (this.far && !wide) {
      // The inverse condition skips a `b` that reaches anywhere.
      const inverse = (w & 0xff000000) === 0x54000000 ? w ^ 1 : w ^ 0x01000000;
      this.emit(inverse | (2 << 5));
      this.b(l);
      return;
    }
    this.fixAt.push(this.here());
    this.fixLabel.push(l);
    this.fixWide.push(wide);
    this.emit(w);
  }

  b(this: Mut<this>, l: i64): void {
    this.branch(0x14000000, l, true);
  }

  bcond(this: Mut<this>, cond: i64, l: i64): void {
    this.branch(0x54000000 | cond, l, false);
  }

  cbnz(this: Mut<this>, r: i64, l: i64): void {
    this.branch(0xb5000000 | r, l, false);
  }

  cbz(this: Mut<this>, r: i64, l: i64): void {
    this.branch(0xb4000000 | r, l, false);
  }

  callNamed(this: Mut<this>, name: string): void {
    const sym = this.ir.symbolNamed(name);
    this.bl(sym);
  }

  bl(this: Mut<this>, sym: i64): void {
    this.reloc(sym, RELOC_BRANCH26);
    this.emit(0x94000000);
    this.page = -1;
  }

  // ---- instructions

  movReg(this: Mut<this>, rd: i64, rm: i64): void {
    if (rd === rm) return;
    this.emit(0xaa0003e0 | (rm << 16) | rd);
  }

  // add/sub with a 12-bit immediate, shifted by 12 when `shift`. sp may be either register.
  addImm12(this: Mut<this>, rd: i64, rn: i64, imm: i64, shift: boolean, sub: boolean): void {
    this.emit((sub ? 0xd1000000 : 0x91000000) | (shift ? 1 << 22 : 0) | (imm << 10) | (rn << 5) | rd);
  }

  // rd = rn + imm for any imm; rn may be sp. Uses rd for a large constant, so rd mustn't be rn then.
  addImm(this: Mut<this>, rd: i64, rn: i64, imm: i64): void {
    if (imm === 0) {
      if (rd !== rn) this.addImm12(rd, rn, 0, false, false);
      return;
    }
    const sub = imm < 0;
    const a = sub ? 0 - imm : imm;
    if (a < 4096) {
      this.addImm12(rd, rn, a, false, sub);
      return;
    }
    if (a < 16777216) {
      this.addImm12(rd, rn, a >> 12, true, sub);
      if ((a & 4095) !== 0) this.addImm12(rd, rd, a & 4095, false, sub);
      return;
    }
    if (rd === rn) refuse("an offset past 16 MB from a register it replaces");
    this.movImm(rd, imm);
    // add rd, rn, rd (extended register, so rn may be sp)
    this.emit(0x8b206000 | (rd << 16) | (rn << 5) | rd);
  }

  movImm(this: Mut<this>, rd: i64, v: i64): void {
    const u = v as u64;
    let zeros = 0;
    let ones = 0;
    for (let i: u64 = 0; i < 4; i++) {
      const h = (u >> (i * 16)) & 0xffff;
      if (h === 0) zeros++;
      if (h === 0xffff) ones++;
    }
    if (ones > zeros) {
      let first = true;
      for (let i: u64 = 0; i < 4; i++) {
        const h = (u >> (i * 16)) & 0xffff;
        if (h === 0xffff) continue;
        if (first) {
          this.emit(0x92800000 | ((i as i64) << 21) | ((((~h) & 0xffff) as i64) << 5) | rd);
          first = false;
        } else this.emit(0xf2800000 | ((i as i64) << 21) | ((h as i64) << 5) | rd);
      }
      if (first) this.emit(0x92800000 | rd);
      return;
    }
    let first = true;
    for (let i: u64 = 0; i < 4; i++) {
      const h = (u >> (i * 16)) & 0xffff;
      if (h === 0) continue;
      if (first) {
        this.emit(0xd2800000 | ((i as i64) << 21) | ((h as i64) << 5) | rd);
        first = false;
      } else this.emit(0xf2800000 | ((i as i64) << 21) | ((h as i64) << 5) | rd);
    }
    if (first) this.emit(0xd2800000 | rd);
  }

  // A three-register data instruction: `base | rm << 16 | rn << 5 | rd`.
  r3(this: Mut<this>, base: i64, rd: i64, rn: i64, rm: i64): void {
    this.emit(base | (rm << 16) | (rn << 5) | rd);
  }

  cmpReg(this: Mut<this>, rn: i64, rm: i64): void {
    this.r3(0xeb000000, ZR, rn, rm);
  }

  cmpImm(this: Mut<this>, rn: i64, imm: i64): void {
    if (imm >= 0 && imm < 4096) {
      this.emit(0xf100001f | (imm << 10) | (rn << 5));
      return;
    }
    this.page = -1;
    this.movImm(X17, imm);
    this.cmpReg(rn, X17);
  }

  cset(this: Mut<this>, rd: i64, cond: i64): void {
    this.emit(0x9a9f07e0 | ((cond ^ 1) << 12) | rd);
  }

  csel(this: Mut<this>, rd: i64, rn: i64, rm: i64, cond: i64): void {
    this.emit(0x9a800000 | (rm << 16) | (cond << 12) | (rn << 5) | rd);
  }

  // ubfm/sbfm: keep (or sign-extend) the low `bits` bits.
  zeroExtend(this: Mut<this>, rd: i64, rn: i64, bits: i64): void {
    if (bits >= 64) {
      this.movReg(rd, rn);
      return;
    }
    this.emit(0xd3400000 | ((bits - 1) << 10) | (rn << 5) | rd);
  }

  signExtend(this: Mut<this>, rd: i64, rn: i64, bits: i64): void {
    if (bits >= 64) {
      this.movReg(rd, rn);
      return;
    }
    this.emit(0x93400000 | ((bits - 1) << 10) | (rn << 5) | rd);
  }

  lsrImm(this: Mut<this>, rd: i64, rn: i64, sh: i64): void {
    this.emit(0xd3400000 | (sh << 16) | (63 << 10) | (rn << 5) | rd);
  }

  asrImm(this: Mut<this>, rd: i64, rn: i64, sh: i64): void {
    this.emit(0x93400000 | (sh << 16) | (63 << 10) | (rn << 5) | rd);
  }

  brk(this: Mut<this>): void {
    this.emit(0xd4200020);
  }

  // A load or store of `rt` at `rn + off`, scaled when it can be, unscaled when that reaches, and
  // through x17 otherwise.
  mem(this: Mut<this>, op: i64, rt: i64, rn: i64, off: i64): void {
    const log = (op >> 30) & 3;
    const size: i64 = 1 << log;
    if (off >= 0 && (off & (size - 1)) === 0 && (off >> log) < 4096) {
      this.emit(op | ((off >> log) << 10) | (rn << 5) | rt);
      return;
    }
    if (off >= -256 && off < 256) {
      // The unscaled form: bit 24 clear, imm9 at bit 12.
      this.emit((op & ~0x01000000) | ((off & 0x1ff) << 12) | (rn << 5) | rt);
      return;
    }
    if (rn === SP && off > 0 && off < 16777216) {
      // x17 holds sp plus a 4 KB page of the frame, kept while nothing else writes it.
      const page = off >> 12;
      if (this.page !== page) {
        this.addImm12(X17, SP, page, true, false);
        this.page = page;
      }
      this.mem(op, rt, X17, off & 4095);
      return;
    }
    this.page = -1;
    this.addImm(X17, rn, off);
    this.emit(op | (X17 << 5) | rt);
  }

  // ---- types

  size(t: i64): i64 {
    return this.ir.tsize[t as usize]!;
  }

  kind(t: i64): i64 {
    return this.ir.tk[t as usize]!;
  }

  bits(t: i64): i64 {
    const k = this.kind(t);
    if (k === K_PTR) return 64;
    return this.ir.tbits[t as usize]!;
  }

  isAgg(t: i64): boolean {
    const k = this.kind(t);
    return k === K_STRUCT || k === K_ARRAY;
  }

  isFloat(t: i64): boolean {
    const k = this.kind(t);
    return k === K_FLOAT || k === K_DOUBLE;
  }

  loadOp(size: i64): i64 {
    if (size === 1) return LDRB;
    if (size === 2) return LDRH;
    if (size === 4) return LDRW;
    return LDRX;
  }

  storeOp(size: i64): i64 {
    if (size === 1) return STRB;
    if (size === 2) return STRH;
    if (size === 4) return STRW;
    return STRX;
  }

  // ---- operands

  opKind(o: i64): i64 {
    return this.ir.f.ok[o as usize]!;
  }

  opType(o: i64): i64 {
    return this.ir.f.ot[o as usize]!;
  }

  opValue(o: i64): i64 {
    return this.ir.f.ov[o as usize]!;
  }

  opExtra(o: i64): i64 {
    return this.ir.f.ox[o as usize]!;
  }

  operandOf(i: i64, n: i64): i64 {
    return this.ir.f.ifirst[i as usize]! + n;
  }

  isAlloca(o: i64): boolean {
    return this.opKind(o) === O_LOCAL && this.ir.f.vkind[this.opValue(o) as usize]! === V_ALLOCA;
  }

  slotOf(v: i64): i64 {
    const s = this.slot[v as usize]!;
    if (s < 0) refuse("a value with no slot");
    return s;
  }

  // A symbol's address into `rd`: direct for one defined here, through the GOT otherwise, and
  // through its TLV descriptor for a thread-local one, which clobbers x0 and lr.
  symbolAddress(this: Mut<this>, rd: i64, sym: i64): void {
    if (this.ir.symTls[sym as usize]!) {
      this.reloc(sym, RELOC_TLVP_PAGE21);
      this.emit(0x90000000 | X0);
      this.reloc(sym, RELOC_TLVP_PAGEOFF12);
      this.emit(LDRX | (X0 << 5) | X0);
      this.emit(LDRX | (X0 << 5) | X16);
      this.emit(0xd63f0000 | (X16 << 5));
      this.page = -1;
      this.movReg(rd, X0);
      return;
    }
    if (this.ir.symDefined[sym as usize]!) {
      this.reloc(sym, RELOC_PAGE21);
      this.emit(0x90000000 | rd);
      this.reloc(sym, RELOC_PAGEOFF12);
      this.emit(0x91000000 | (rd << 5) | rd);
      return;
    }
    this.reloc(sym, RELOC_GOT_PAGE21);
    this.emit(0x90000000 | rd);
    this.reloc(sym, RELOC_GOT_PAGEOFF12);
    this.emit(LDRX | (rd << 5) | rd);
  }

  // A scalar operand of up to 64 bits into `rd`, zero-extended past its width; a float's bits.
  value(this: Mut<this>, o: i64, rd: i64): void {
    const k = this.opKind(o);
    if (k === O_LOCAL) {
      const v = this.opValue(o);
      if (this.ir.f.vkind[v as usize]! === V_ALLOCA) this.addImm(rd, SP, this.slotOf(v));
      else this.mem(LDRX, rd, SP, this.slotOf(v));
    } else if (k === O_INT) this.movImm(rd, this.opValue(o));
    else if (k === O_ZERO) this.movImm(rd, 0);
    else if (k === O_SYM) {
      this.symbolAddress(rd, this.opValue(o));
      if (this.opExtra(o) !== 0) this.addImm(rd, rd, this.opExtra(o));
    } else refuse("a constant aggregate where a scalar was expected");
  }

  // An i128 operand into two registers.
  pair(this: Mut<this>, o: i64, lo: i64, hi: i64): void {
    const k = this.opKind(o);
    if (k === O_LOCAL) {
      const s = this.slotOf(this.opValue(o));
      this.mem(LDRX, lo, SP, s);
      this.mem(LDRX, hi, SP, s + 8);
    } else if (k === O_INT) {
      this.movImm(lo, this.opValue(o));
      this.movImm(hi, this.opExtra(o));
    } else {
      this.movImm(lo, 0);
      this.movImm(hi, 0);
    }
  }

  // A float operand into a d or s register.
  fvalue(this: Mut<this>, o: i64, d: i64, single: boolean): void {
    const k = this.opKind(o);
    if (k === O_LOCAL) {
      this.mem(single ? LDRS : LDRD, d, SP, this.slotOf(this.opValue(o)));
      return;
    }
    this.value(o, X16);
    this.emit((single ? 0x1e270000 : 0x9e670000) | (X16 << 5) | d);
  }

  store(this: Mut<this>, v: i64, r: i64): void {
    if (v < 0) return;
    this.mem(STRX, r, SP, this.slotOf(v));
  }

  storePair(this: Mut<this>, v: i64, lo: i64, hi: i64): void {
    if (v < 0) return;
    const s = this.slotOf(v);
    this.mem(STRX, lo, SP, s);
    this.mem(STRX, hi, SP, s + 8);
  }

  fstore(this: Mut<this>, v: i64, d: i64, single: boolean): void {
    if (v < 0) return;
    this.mem(single ? STRS : STRD, d, SP, this.slotOf(v));
  }

  // A frame slot for the rest of the function.
  temp(this: Mut<this>, size: i64, align: i64): i64 {
    const a = align < 8 ? 8 : align;
    this.top = (this.top + a - 1) / a * a;
    const at = this.top;
    this.top += size < 8 ? 8 : (size + 7) / 8 * 8;
    return at;
  }

  // A temporary for the instruction being lowered, in the scratch area every instruction reuses.
  scratch(this: Mut<this>, size: i64, align: i64): i64 {
    const a = align < 8 ? 8 : align;
    this.scratchTop = (this.scratchTop + a - 1) / a * a;
    const at = this.scratchTop;
    this.scratchTop += size < 8 ? 8 : (size + 7) / 8 * 8;
    if (this.scratchTop > this.scratchEnd) this.scratchEnd = this.scratchTop;
    return at;
  }

  // Where an aggregate operand's bytes are: its slot, or a temporary written from its constant.
  // Gives the offset from sp.
  aggregate(this: Mut<this>, o: i64): i64 {
    const k = this.opKind(o);
    if (k === O_LOCAL) return this.slotOf(this.opValue(o));
    const t = this.opType(o);
    const at = this.scratch(this.size(t), this.ir.talign[t as usize]!);
    this.constantAt(o, SP, at);
    return at;
  }

  // An aggregate constant (or zero) written at `base + off`.
  constantAt(this: Mut<this>, o: i64, base: i64, off: i64): void {
    const t = this.opType(o);
    const size = this.size(t);
    if (this.opKind(o) !== O_BLOB) {
      this.zero(base, off, size);
      return;
    }
    const b = this.opValue(o);
    const first = this.ir.f.blobFirst[b as usize]!;
    let k: i64 = 0;
    while (k < size) {
      const chunk: i64 = size - k >= 8 ? 8 : size - k >= 4 ? 4 : size - k >= 2 ? 2 : 1;
      let word: i64 = 0;
      for (let j: i64 = chunk - 1; j >= 0; j--) word = (word << 8) | (this.ir.f.blobData[(first + k + j) as usize]! as i64);
      if (word === 0) this.mem(this.storeOp(chunk), ZR, base, off + k);
      else {
        this.movImm(X9, word);
        this.mem(this.storeOp(chunk), X9, base, off + k);
      }
      k += chunk;
    }
    const rf = this.ir.f.blobRelFirst[b as usize]!;
    const rn = this.ir.f.blobRelCount[b as usize]!;
    for (let r: i64 = rf; r < rf + rn; r++) {
      this.symbolAddress(X9, this.ir.f.relSym[r as usize]!);
      const add = this.ir.f.relAdd[r as usize]!;
      if (add !== 0) this.addImm(X9, X9, add);
      this.mem(STRX, X9, base, off + this.ir.f.relOff[r as usize]!);
    }
  }

  zero(this: Mut<this>, base: i64, off: i64, size: i64): void {
    let k: i64 = 0;
    while (k < size) {
      const chunk: i64 = size - k >= 8 ? 8 : size - k >= 4 ? 4 : size - k >= 2 ? 2 : 1;
      this.mem(this.storeOp(chunk), ZR, base, off + k);
      k += chunk;
    }
  }

  // Copies `size` bytes; neither base may be x9 or x17.
  copy(this: Mut<this>, db: i64, doff: i64, sb: i64, soff: i64, size: i64): void {
    let k: i64 = 0;
    while (k < size) {
      const chunk: i64 = size - k >= 8 ? 8 : size - k >= 4 ? 4 : size - k >= 2 ? 2 : 1;
      this.mem(this.loadOp(chunk), X9, sb, soff + k);
      this.mem(this.storeOp(chunk), X9, db, doff + k);
      k += chunk;
    }
  }

  // An operand of any type copied into `base + off` as it lies in memory.
  put(this: Mut<this>, o: i64, base: i64, off: i64): void {
    const t = this.opType(o);
    if (this.isAgg(t)) {
      if (this.opKind(o) === O_LOCAL) this.copy(base, off, SP, this.slotOf(this.opValue(o)), this.size(t));
      else this.constantAt(o, base, off);
      return;
    }
    if (t === T_I128) {
      this.pair(o, X9, X10);
      this.mem(STRX, X9, base, off);
      this.mem(STRX, X10, base, off + 8);
      return;
    }
    this.value(o, X9);
    this.mem(this.storeOp(this.size(t)), X9, base, off);
  }

  // A value of type `t` read from `base + off` into value `v`'s slot.
  take(this: Mut<this>, v: i64, t: i64, base: i64, off: i64): void {
    if (v < 0) return;
    const s = this.slotOf(v);
    if (this.isAgg(t) || t === T_I128) {
      this.copy(SP, s, base, off, this.size(t));
      return;
    }
    this.mem(this.loadOp(this.size(t)), X9, base, off);
    this.mem(STRX, X9, SP, s);
  }

  // A pointer operand as a base and offset: an alloca's slot, or the pointer in x16.
  address(this: Mut<this>, o: i64): i64[] {
    if (this.isAlloca(o)) return [SP, this.slotOf(this.opValue(o))];
    this.value(o, X16);
    return [X16, 0];
  }

  // ---- functions

  // The function the reader holds, lowered.
  func(this: Mut<this>): void {
    const words = this.code.words.length;
    const relocs = this.code.relAt.length;
    this.far = false;
    if (!this.body()) {
      // A conditional branch didn't reach: lowered again with every one able to reach anywhere.
      while (this.code.words.length > words) this.code.words.pop();
      while (this.code.relAt.length > relocs) {
        this.code.relAt.pop();
        this.code.relSym.pop();
        this.code.relType.pop();
      }
      this.far = true;
      if (!this.body()) refuse("a branch that doesn't reach");
    }
    this.code.funcSym.push(this.ir.f.symbol);
    this.code.funcStart.push(this.start * 4);
    this.code.funcLength.push((this.here() - this.start) * 4);
    const lsda = this.siteAt.length > 0 ? this.lsdaOf() : -1;
    this.code.funcLsda.push(lsda);
  }

  // The function's code; false when a conditional branch is too far for its 19 bits.
  body(this: Mut<this>): boolean {
    const ir: Ref<Ir> = this.ir;
    const n = ir.f.iop.length;
    const values = ir.f.vty.length;
    this.slot = new Array(values).fill(-1 as i64);
    this.shadow = new Array(values).fill(-1 as i64);
    this.labelAt = new Array(ir.f.bfirst.length).fill(-1 as i64);
    this.fixAt = [];
    this.fixLabel = [];
    this.fixWide = [];
    this.siteAt = [];
    this.siteLabel = [];
    this.phiFirst = new Array(ir.f.bfirst.length).fill(-1 as i64);
    this.phiCount = new Array(ir.f.bfirst.length).fill(0 as i64);
    this.sret = -1;
    let outgoing: i64 = 0;
    for (let i: usize = 0; i < n; i++) {
      const op = this.ir.f.iop[i]!;
      if (op === I_CALL || op === I_INVOKE) {
        const bytes = this.argumentBytes(i as i64);
        if (bytes > outgoing) outgoing = bytes;
      }
    }
    this.outgoing = (outgoing + 15) / 16 * 16;
    this.top = this.outgoing;
    // Nearest sp, where the shortest offsets reach, the allocas, then the region the blocks' own
    // values share (a value made and used in one block alone), then every other value's slot and
    // each phi's shadow, and last the scratch area each instruction reuses.
    for (let i: usize = 0; i < n; i++) {
      if (this.ir.f.iop[i]! !== I_ALLOCA) continue;
      const t = this.ir.f.iaux2[i]!;
      this.slot[this.ir.f.ires[i]! as usize] = this.temp(this.size(t), this.ir.talign[t as usize]!);
    }
    const home = this.homes();
    this.top = (this.top + 15) / 16 * 16;
    const region = this.top;
    let regionEnd = region;
    for (let b: usize = 0; b < this.ir.f.bfirst.length; b++) {
      const end = this.blockSlots(b as i64, home, region);
      if (end > regionEnd) regionEnd = end;
    }
    this.top = this.sharedSlots(home, regionEnd);
    // A phi needs a shadow only when an edge gives it another phi of its block, whose old value a
    // copy on that edge must still read; any other phi takes its value straight into its slot.
    let phiBlock: i64[] = new Array(values).fill(-1 as i64);
    for (let b: usize = 0; b < this.ir.f.bfirst.length; b++) {
      const first = this.ir.f.bfirst[b]!;
      if (first < 0) continue;
      for (let i = first; i < first + this.ir.f.bcount[b]!; i++) {
        if (this.ir.f.iop[i as usize]! !== I_PHI) break;
        const r = this.ir.f.ires[i as usize]!;
        if (r >= 0) phiBlock[r as usize] = b as i64;
      }
    }
    for (let i: usize = 0; i < n; i++) {
      const r = this.ir.f.ires[i]!;
      if (this.ir.f.iop[i]! !== I_PHI || r < 0) continue;
      const o0 = this.ir.f.ifirst[i]!;
      let crossed = false;
      for (let k = o0; k < o0 + this.ir.f.icount[i]!; k += 2) {
        if (this.ir.f.ok[k as usize]! === O_LOCAL && phiBlock[this.ir.f.ov[k as usize]! as usize]! === phiBlock[r as usize]!) crossed = true;
      }
      const t = this.ir.f.ity[i]!;
      this.shadow[r as usize] = crossed ? this.temp(this.size(t), this.ir.talign[t as usize]!) : this.slot[r as usize]!;
    }
    // Each block's phis, which lead it.
    for (let b: usize = 0; b < this.ir.f.bfirst.length; b++) {
      const first = this.ir.f.bfirst[b]!;
      if (first < 0) continue;
      const count = this.ir.f.bcount[b]!;
      let k: i64 = 0;
      while (k < count && this.ir.f.iop[(first + k) as usize]! === I_PHI) k++;
      if (k > 0) {
        this.phiFirst[b] = first;
        this.phiCount[b] = k;
      }
    }
    const returns = this.ir.f.returns;
    if (this.isAgg(returns)) this.sret = this.temp(8, 8);
    this.scratchTop = (this.top + 15) / 16 * 16;
    this.scratchBase = this.scratchTop;
    this.scratchEnd = this.scratchTop;
    this.page = -1;
    // The prologue; the frame's size is filled in once every temporary is made.
    this.start = this.here();
    this.emit(0xa9bf7bfd);
    this.emit(0x910003fd);
    const sizing = this.here();
    this.emit(0);
    this.emit(0);
    if (this.sret >= 0) this.mem(STRX, X8, SP, this.sret);
    this.parameters();
    // Blocks in the order they are written.
    let order: i64[] = [];
    for (let b: usize = 0; b < this.ir.f.bfirst.length; b++) if (this.ir.f.bfirst[b]! >= 0) order.push(b as i64);
    order.sort((a, c) => this.ir.f.bfirst[a as usize]! - this.ir.f.bfirst[c as usize]!);
    for (const b of order) {
      this.current = b;
      this.bind(b);
      const first = this.ir.f.bfirst[b as usize]!;
      const count = this.ir.f.bcount[b as usize]!;
      // A phi takes the value its edge left in its shadow.
      for (let k: i64 = 0; k < this.phiCount[b as usize]!; k++) {
        const r = this.ir.f.ires[(first + k) as usize]!;
        if (r < 0) continue;
        const t = this.ir.f.ity[(first + k) as usize]!;
        if (this.shadow[r as usize]! !== this.slotOf(r)) this.copy(SP, this.slotOf(r), SP, this.shadow[r as usize]!, this.slotBytes(t));
      }
      for (let i = first + this.phiCount[b as usize]!; i < first + count; i++) {
        this.scratchTop = this.scratchBase;
        this.instruction(i);
      }
    }
    const frame = (this.scratchEnd + 15) / 16 * 16;
    if (frame >= 16777216) refuse("a frame past 16 MB");
    this.code.words[sizing as usize] = 0xd1000000 | (1 << 22) | ((frame >> 12) << 10) | (SP << 5) | SP;
    this.code.words[(sizing + 1) as usize] = 0xd1000000 | ((frame & 4095) << 10) | (SP << 5) | SP;
    for (let k: usize = 0; k < this.fixAt.length; k++) {
      const at = this.fixAt[k]!;
      const target = this.labelAt[this.fixLabel[k]! as usize]!;
      if (target < 0) refuse("a branch to a block that isn't there");
      const delta = target - at;
      const w = this.code.words[at as usize]!;
      if (this.fixWide[k]!) this.code.words[at as usize] = w | (delta & 0x3ffffff);
      else {
        if (delta >= 262144 || delta < -262144) return false;
        this.code.words[at as usize] = w | ((delta & 0x7ffff) << 5);
      }
    }
    return true;
  }

  // Each value's block when it is made and used in that one block alone, else -1: parameters,
  // phis' incoming values (copied on the edge, in another block) and values crossing blocks.
  homes(this: Mut<this>): i64[] {
    const values = this.ir.f.vty.length;
    let home: i64[] = new Array(values).fill(-2 as i64);
    for (const p of this.ir.f.params) home[p as usize] = -1;
    for (let b: usize = 0; b < this.ir.f.bfirst.length; b++) {
      const first = this.ir.f.bfirst[b]!;
      if (first < 0) continue;
      const count = this.ir.f.bcount[b]!;
      for (let i = first; i < first + count; i++) {
        const r = this.ir.f.ires[i as usize]!;
        const phi = this.ir.f.iop[i as usize]! === I_PHI;
        // A phi's slot is written on each edge into it, from other blocks.
        if (r >= 0) home[r as usize] = phi ? -1 : placed(home[r as usize]!, b as i64);
        const o0 = this.ir.f.ifirst[i as usize]!;
        const n = this.ir.f.icount[i as usize]!;
        for (let k = o0; k < o0 + n; k++) {
          if (this.ir.f.ok[k as usize]! !== O_LOCAL) continue;
          const v = this.ir.f.ov[k as usize]!;
          home[v as usize] = phi ? -1 : placed(home[v as usize]!, b as i64);
        }
      }
    }
    return home;
  }

  // Slots in the shared region for block `b`'s own values, a slot taken again once the value in it
  // is last used. A result gets its slot before its operands' are given back, so no instruction
  // writes over an operand it still reads. Gives the region's end for this block.
  blockSlots(this: Mut<this>, b: i64, home: Ref<i64[]>, region: i64): i64 {
    const first = this.ir.f.bfirst[b as usize]!;
    if (first < 0) return region;
    const count = this.ir.f.bcount[b as usize]!;
    let last = new Map<i64, i64>();
    for (let i = first; i < first + count; i++) {
      const o0 = this.ir.f.ifirst[i as usize]!;
      for (let k = o0; k < o0 + this.ir.f.icount[i as usize]!; k++) {
        if (this.ir.f.ok[k as usize]! !== O_LOCAL) continue;
        const v = this.ir.f.ov[k as usize]!;
        if (home[v as usize]! === b) last.set(v, i);
      }
    }
    // Free slots by size.
    let free = new Map<i64, i64[]>();
    let top = region;
    let end = region;
    for (let i = first; i < first + count; i++) {
      const r = this.ir.f.ires[i as usize]!;
      if (r >= 0 && home[r as usize]! === b && this.ir.f.vkind[r as usize]! !== V_ALLOCA) {
        const key = this.slotKey(r);
        let list = free.get(key);
        if (list !== undefined && list.length > 0) {
          let l: i64[] = list;
          this.slot[r as usize] = l.pop()!;
          free.set(key, l);
        } else {
          const a: i64 = (key & 1) === 1 ? 16 : 8;
          this.slot[r as usize] = (top + a - 1) / a * a;
          top = this.slot[r as usize]! + (key >> 1);
          if (top > end) end = top;
        }
        // A value nothing reads frees its slot at once.
        if (!last.has(r)) {
          release(free, key, this.slot[r as usize]!);
        }
      }
      const o0 = this.ir.f.ifirst[i as usize]!;
      for (let k = o0; k < o0 + this.ir.f.icount[i as usize]!; k++) {
        if (this.ir.f.ok[k as usize]! !== O_LOCAL) continue;
        const v = this.ir.f.ov[k as usize]!;
        if (home[v as usize]! !== b || last.get(v) !== i || this.ir.f.vkind[v as usize]! === V_ALLOCA) continue;
        last.delete(v);
        const key = this.slotKey(v);
        release(free, key, this.slot[v as usize]!);
      }
    }
    return end;
  }

  // Slots for the values that cross blocks, shared between values whose live ranges don't meet.
  // A range runs over the blocks as they are laid out, from the first place the value is made,
  // read or written (a phi on each edge into it) to the last, and a range meeting a loop (a branch
  // back to an earlier block) covers the whole loop. Gives the end of the slots, from `start`.
  sharedSlots(this: Mut<this>, home: Ref<i64[]>, start: i64): i64 {
    const values = this.ir.f.vty.length;
    const blocks = this.ir.f.bfirst.length;
    let order: i64[] = [];
    for (let b: usize = 0; b < blocks; b++) if (this.ir.f.bfirst[b]! >= 0) order.push(b as i64);
    order.sort((a, c) => this.ir.f.bfirst[a as usize]! - this.ir.f.bfirst[c as usize]!);
    // Each block's first and last place.
    let first: i64[] = new Array(blocks).fill(0 as i64);
    let last: i64[] = new Array(blocks).fill(0 as i64);
    let at: i64 = 1;
    for (const b of order) {
      first[b as usize] = at;
      at += this.ir.f.bcount[b as usize]!;
      last[b as usize] = at - 1;
    }
    let lo: i64[] = new Array(values).fill(I64_MAX);
    let hi: i64[] = new Array(values).fill(-1 as i64);
    let loopFrom: i64[] = [];
    let loopTo: i64[] = [];
    for (const p of this.ir.f.params) {
      lo[p as usize] = 0;
      hi[p as usize] = 0;
    }
    for (const b of order) {
      const f = this.ir.f.bfirst[b as usize]!;
      for (let k: i64 = 0; k < this.ir.f.bcount[b as usize]!; k++) {
        const i = f + k;
        const place = first[b as usize]! + k;
        const r = this.ir.f.ires[i as usize]!;
        if (r >= 0) touch(lo, hi, r, place);
        const o0 = this.ir.f.ifirst[i as usize]!;
        const n = this.ir.f.icount[i as usize]!;
        if (this.ir.f.iop[i as usize]! === I_PHI) {
          for (let j: i64 = 0; j < n; j += 2) {
            const pred = this.ir.f.ov[(o0 + j + 1) as usize]!;
            const edge = last[pred as usize]!;
            if (r >= 0) touch(lo, hi, r, edge);
            if (this.ir.f.ok[(o0 + j) as usize]! === O_LOCAL) touch(lo, hi, this.ir.f.ov[(o0 + j) as usize]!, edge);
          }
          continue;
        }
        for (let j = o0; j < o0 + n; j++) {
          const kind = this.ir.f.ok[j as usize]!;
          if (kind === O_LOCAL) touch(lo, hi, this.ir.f.ov[j as usize]!, place);
          else if (kind === O_LABEL) {
            const to = first[this.ir.f.ov[j as usize]! as usize]!;
            if (to <= place) {
              loopFrom.push(to);
              loopTo.push(place);
            }
          }
        }
      }
    }
    // Ranges meeting a loop take in the whole loop, until no range grows.
    let shared: i64[] = [];
    for (let v: usize = 0; v < values; v++) {
      if (home[v]! >= 0 || hi[v]! < 0 || this.ir.f.vty[v]! < 0 || this.ir.f.vkind[v]! === V_ALLOCA) continue;
      shared.push(v as i64);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (let e: usize = 0; e < loopFrom.length; e++) {
        const a = loopFrom[e]!;
        const z = loopTo[e]!;
        for (const v of shared) {
          const l = lo[v as usize]!;
          const h = hi[v as usize]!;
          if (h < a || l > z || (l <= a && h >= z)) continue;
          if (l > a) lo[v as usize] = a;
          if (h < z) hi[v as usize] = z;
          grew = true;
        }
      }
    }
    // A linear scan: ranges by start, each slot given back once the range in it has ended.
    let byStart = shared.slice();
    byStart.sort((a, c) => lo[a as usize]! - lo[c as usize]!);
    let byEnd = shared.slice();
    byEnd.sort((a, c) => hi[a as usize]! - hi[c as usize]!);
    let free = new Map<i64, i64[]>();
    let top = start;
    let end = start;
    let e: usize = 0;
    for (const v of byStart) {
      while (e < byEnd.length && hi[byEnd[e]! as usize]! < lo[v as usize]!) {
        const done = byEnd[e]!;
        release(free, this.slotKey(done), this.slot[done as usize]!);
        e++;
      }
      const key = this.slotKey(v);
      const had = free.get(key);
      if (had !== undefined && had.length > 0) {
        let l: i64[] = had;
        this.slot[v as usize] = l.pop()!;
        free.set(key, l);
        continue;
      }
      const a: i64 = (key & 1) === 1 ? 16 : 8;
      this.slot[v as usize] = (top + a - 1) / a * a;
      top = this.slot[v as usize]! + (key >> 1);
      if (top > end) end = top;
    }
    return end;
  }

  // A slot's size in bytes times two, plus one when it is 16-aligned: slots of one key are
  // interchangeable.
  slotKey(v: i64): i64 {
    const t = this.ir.f.vty[v as usize]!;
    const size = this.size(t);
    const bytes: i64 = size < 8 ? 8 : (size + 7) / 8 * 8;
    return bytes * 2 + (this.ir.talign[t as usize]! > 8 ? 1 : 0);
  }

  // A value's bytes in its slot: a scalar's whole word, zero-extended, or the aggregate's layout.
  slotBytes(t: i64): i64 {
    if (this.isAgg(t)) return this.size(t);
    return t === T_I128 ? 16 : 8;
  }

  // An operand into a slot at `off`, as a slot holds it.
  toSlot(this: Mut<this>, o: i64, off: i64): void {
    const t = this.opType(o);
    if (this.isAgg(t)) {
      this.put(o, SP, off);
      return;
    }
    if (t === T_I128) {
      this.pair(o, X9, X10);
      this.mem(STRX, X9, SP, off);
      this.mem(STRX, X10, SP, off + 8);
      return;
    }
    this.value(o, X9);
    this.mem(STRX, X9, SP, off);
  }

  // The LSDA of the function just lowered: every invoke's call a site with its landing pad and
  // no action, which `__gcc_personality_v0` runs as a cleanup. Gives its offset in `lsda`.
  lsdaOf(this: Mut<this>): i64 {
    while (this.code.lsda.length % 4 !== 0) this.code.lsda.push(0);
    const at = this.code.lsda.length as i64;
    let table: u8[] = [];
    for (let k: usize = 0; k < this.siteAt.length; k++) {
      uleb(table, (this.siteAt[k]! - this.start) * 4);
      uleb(table, 4);
      uleb(table, (this.labelAt[this.siteLabel[k]! as usize]! - this.start) * 4);
      uleb(table, 0);
    }
    this.code.lsda.push(0xff);
    this.code.lsda.push(0xff);
    this.code.lsda.push(0x01);
    uleb(this.code.lsda, table.length as i64);
    for (const b of table) this.code.lsda.push(b);
    return at;
  }

  // Each parameter from its register or the caller's stack into its slot.
  parameters(this: Mut<this>): void {
    let ngrn: i64 = 0;
    let nsrn: i64 = 0;
    let stack: i64 = 0;
    for (let k: usize = 0; k < this.ir.f.params.length; k++) {
      const v = this.ir.f.params[k]!;
      const t = this.ir.f.vty[v as usize]!;
      const s = this.slotOf(v);
      if (this.isAgg(t)) {
        let p = X9;
        if (ngrn < 8) {
          p = ngrn;
          ngrn++;
        } else {
          stack = (stack + 7) / 8 * 8;
          this.mem(LDRX, X16, FP, 16 + stack);
          stack += 8;
          p = X16;
        }
        // The caller's copy is read through p; x9 and x17 are the copy's own scratch.
        if (p === X9) refuse("an aggregate parameter in x9");
        this.copy(SP, s, p, 0, this.size(t));
      } else if (t === T_I128) {
        // Darwin takes the next two registers, even or odd.
        if (ngrn <= 6) {
          this.mem(STRX, ngrn, SP, s);
          this.mem(STRX, ngrn + 1, SP, s + 8);
          ngrn += 2;
        } else {
          ngrn = 8;
          stack = (stack + 15) / 16 * 16;
          this.copy(SP, s, FP, 16 + stack, 16);
          stack += 16;
        }
      } else if (this.isFloat(t)) {
        const single = this.kind(t) === K_FLOAT;
        if (nsrn < 8) {
          this.mem(single ? STRS : STRD, nsrn, SP, s);
          nsrn++;
        } else {
          const size = this.size(t);
          stack = (stack + size - 1) / size * size;
          this.copy(SP, s, FP, 16 + stack, size);
          stack += size;
        }
      } else {
        const bits = this.bits(t);
        if (ngrn < 8) {
          this.zeroExtend(X9, ngrn, bits);
          this.mem(STRX, X9, SP, s);
          ngrn++;
        } else {
          const size = this.size(t);
          stack = (stack + size - 1) / size * size;
          this.mem(this.loadOp(size), X9, FP, 16 + stack);
          this.mem(STRX, X9, SP, s);
          stack += size;
        }
      }
    }
  }

  // The stack bytes a call's arguments take.
  argumentBytes(this: Mut<this>, i: i64): i64 {
    const a = this.arguments(i);
    return a[a.length - 1]!;
  }

  // Where each argument of call `i` goes: per argument, a register (0-7 x, 32-39 d, 64+ a
  // stack offset), then the stack bytes in all.
  arguments(this: Mut<this>, i: i64): i64[] {
    const count = this.callArgs(i);
    const fixed = this.ir.f.iaux2[i as usize]!;
    let out: i64[] = [];
    let ngrn: i64 = 0;
    let nsrn: i64 = 0;
    let stack: i64 = 0;
    for (let k: i64 = 0; k < count; k++) {
      const o = this.operandOf(i, k + 1);
      const t = this.opType(o);
      if (fixed >= 0 && k >= fixed) {
        const a: i64 = t === T_I128 ? 16 : 8;
        stack = (stack + a - 1) / a * a;
        out.push(64 + stack);
        stack += a;
        continue;
      }
      if (t === T_I128) {
        if (ngrn <= 6) {
          out.push(ngrn);
          ngrn += 2;
        } else {
          ngrn = 8;
          stack = (stack + 15) / 16 * 16;
          out.push(64 + stack);
          stack += 16;
        }
      } else if (this.isFloat(t)) {
        if (nsrn < 8) {
          out.push(32 + nsrn);
          nsrn++;
        } else {
          const size = this.size(t);
          stack = (stack + size - 1) / size * size;
          out.push(64 + stack);
          stack += size;
        }
      } else {
        if (ngrn < 8) {
          out.push(ngrn);
          ngrn++;
        } else {
          const size = this.isAgg(t) ? 8 : this.size(t);
          stack = (stack + size - 1) / size * size;
          out.push(64 + stack);
          stack += size;
        }
      }
    }
    out.push(stack);
    return out;
  }

  // How many arguments call `i` passes: its operands after the callee, less an invoke's labels.
  callArgs(i: i64): i64 {
    const n = this.ir.f.icount[i as usize]! - 1;
    return this.ir.f.iop[i as usize]! === I_INVOKE ? n - 2 : n;
  }

  // ---- instructions

  instruction(this: Mut<this>, i: i64): void {
    const op = this.ir.f.iop[i as usize]!;
    const res = this.ir.f.ires[i as usize]!;
    const ty = this.ir.f.ity[i as usize]!;
    const aux = this.ir.f.iaux[i as usize]!;
    const o0 = this.operandOf(i, 0);
    switch (op) {
      case I_ALLOCA:
        return;
      case I_LOAD: {
        const a = this.address(o0);
        if (aux === 1) {
          if (a[0]! === SP) this.addImm(X16, SP, a[1]!);
          // ldar
          this.emit(0x08dffc00 | (this.log2(this.size(ty)) << 30) | (X16 << 5) | X9);
          this.store(res, X9);
          return;
        }
        this.take(res, ty, a[0]!, a[1]!);
        return;
      }
      case I_STORE: {
        const a = this.address(o0 + 1);
        if (aux === 1) {
          if (a[0]! === SP) this.addImm(X16, SP, a[1]!);
          this.value(o0, X9);
          // stlr
          this.emit(0x089ffc00 | (this.log2(this.size(ty)) << 30) | (X16 << 5) | X9);
          return;
        }
        this.put(o0, a[0]!, a[1]!);
        return;
      }
      case I_GEP:
        this.gep(i);
        return;
      case I_EXTRACT: {
        let t = this.opType(o0);
        let off: i64 = 0;
        const n = this.ir.f.icount[i as usize]!;
        for (let k: i64 = 1; k < n; k++) {
          const idx = this.opValue(o0 + k);
          off += this.ir.fieldOffset(t, idx);
          t = this.ir.fieldType(t, idx);
        }
        if (res < 0) return;
        if (this.opKind(o0) === O_ZERO) {
          this.zero(SP, this.slotOf(res), this.size(ty) < 8 ? 8 : this.size(ty));
          return;
        }
        const at = this.aggregate(o0);
        this.take(res, ty, SP, at + off);
        return;
      }
      case I_INSERT: {
        if (res < 0) return;
        const s = this.slotOf(res);
        const k0 = this.opKind(o0);
        if (k0 === O_LOCAL) this.copy(SP, s, SP, this.slotOf(this.opValue(o0)), this.size(ty));
        else this.constantAt(o0, SP, s);
        let t = ty;
        let off: i64 = 0;
        const n = this.ir.f.icount[i as usize]!;
        for (let k: i64 = 2; k < n; k++) {
          const idx = this.opValue(o0 + k);
          off += this.ir.fieldOffset(t, idx);
          t = this.ir.fieldType(t, idx);
        }
        this.put(o0 + 1, SP, s + off);
        return;
      }
      case I_BINARY:
        this.binary(aux, ty, o0, res);
        return;
      case I_FNEG: {
        const single = this.kind(ty) === K_FLOAT;
        this.fvalue(o0, D16, single);
        this.emit((single ? 0x1e214000 : 0x1e614000) | (D16 << 5) | D16);
        this.fstore(res, D16, single);
        return;
      }
      case I_ICMP:
        this.icmp(aux, o0, res);
        return;
      case I_FCMP:
        this.fcmp(aux, o0, res);
        return;
      case I_CAST:
        this.cast(aux, o0, ty, res);
        return;
      case I_SELECT:
        this.select(o0, ty, res);
        return;
      case I_PHI:
        refuse("a phi after a block's first instructions");
      case I_CALL:
      case I_INVOKE:
        this.call(i);
        return;
      case I_BR:
        this.jump(this.opValue(o0));
        return;
      case I_CONDBR:
        this.condbr(o0);
        return;
      case I_SWITCH:
        this.switchOn(i, o0);
        return;
      case I_RET:
        this.ret(o0, ty);
        return;
      case I_UNREACHABLE:
        this.brk();
        return;
      case I_LANDINGPAD: {
        if (res < 0) return;
        const s = this.slotOf(res);
        this.mem(STRX, X0, SP, s);
        this.mem(STRW, X1, SP, s + 8);
        return;
      }
      case I_RESUME: {
        const at = this.aggregate(o0);
        this.mem(LDRX, X0, SP, at);
        this.callNamed("_Unwind_Resume");
        this.brk();
        return;
      }
      case I_RMW:
        this.rmw(aux, o0, ty, res);
        return;
      case I_CMPXCHG: {
        const vt = this.opType(o0 + 1);
        const a = this.address(o0);
        if (a[0]! === SP) this.addImm(X16, SP, a[1]!);
        this.value(o0 + 1, X10);
        this.value(o0 + 2, X11);
        this.movReg(X12, X10);
        const log = this.log2(this.size(vt));
        // casal x10, x11, [x16]
        this.emit(0x08e0fc00 | (log << 30) | (X10 << 16) | (X16 << 5) | X11);
        if (res < 0) return;
        const s = this.slotOf(res);
        this.mem(this.storeOp(this.size(vt)), X10, SP, s);
        this.cmpReg(X10, X12);
        this.cset(X9, EQ);
        this.mem(STRB, X9, SP, s + this.ir.fieldOffset(ty, 1));
        return;
      }
      case I_FENCE:
        this.emit(0xd5033bbf);
        return;
      default:
        refuse(`opcode ${op} has no lowering`);
    }
  }

  log2(size: i64): i64 {
    if (size === 1) return 0;
    if (size === 2) return 1;
    if (size === 4) return 2;
    return 3;
  }

  gep(this: Mut<this>, i: i64): void {
    const o0 = this.operandOf(i, 0);
    const res = this.ir.f.ires[i as usize]!;
    let t = this.ir.f.iaux2[i as usize]!;
    const n = this.ir.f.icount[i as usize]!;
    this.value(o0, X9);
    let c: i64 = 0;
    for (let k: i64 = 1; k < n; k++) {
      const o = o0 + k;
      const kind = this.opKind(o);
      let scale: i64 = 0;
      if (k === 1) scale = this.size(t);
      else if (this.kind(t) === K_STRUCT) {
        const idx = this.opValue(o);
        c += this.ir.fieldOffset(t, idx);
        t = this.ir.fieldType(t, idx);
        continue;
      } else {
        t = this.ir.telem[t as usize]!;
        scale = this.size(t);
      }
      if (kind === O_INT || kind === O_ZERO) {
        const idx = kind === O_ZERO ? 0 : signed(this.opValue(o), this.bits(this.opType(o)));
        c += idx * scale;
        continue;
      }
      this.value(o, X10);
      this.signExtend(X10, X10, this.bits(this.opType(o)));
      this.movImm(X11, scale);
      // madd x9, x10, x11, x9
      this.emit(0x9b000000 | (X11 << 16) | (X9 << 10) | (X10 << 5) | X9);
    }
    if (c !== 0) this.addSigned(X9, c);
    this.store(res, X9);
  }

  // x9 += c for any c, through x17.
  addSigned(this: Mut<this>, r: i64, c: i64): void {
    if (c > -16777216 && c < 16777216) {
      this.addImm(r, r, c);
      return;
    }
    this.page = -1;
    this.movImm(X17, c);
    this.r3(0x8b000000, r, r, X17);
  }

  binary(this: Mut<this>, op: i64, ty: i64, o0: i64, res: i64): void {
    if (this.isFloat(ty)) {
      const single = this.kind(ty) === K_FLOAT;
      if (op === B_FREM) {
        this.fvalue(o0, 0, single);
        this.fvalue(o0 + 1, 1, single);
        this.callNamed(single ? "fmodf" : "fmod");
        this.fstore(res, 0, single);
        return;
      }
      this.fvalue(o0, D16, single);
      this.fvalue(o0 + 1, D17, single);
      let base: i64 = 0;
      if (op === B_FADD) base = 0x1e602800;
      else if (op === B_FSUB) base = 0x1e603800;
      else if (op === B_FMUL) base = 0x1e600800;
      else base = 0x1e601800;
      if (single) base = base & ~0x00400000;
      this.r3(base, D16, D16, D17);
      this.fstore(res, D16, single);
      return;
    }
    if (ty === T_I128) {
      this.wideBinary(op, o0, res);
      return;
    }
    const bits = this.bits(ty);
    this.value(o0, X9);
    this.value(o0 + 1, X10);
    switch (op) {
      case B_ADD:
        this.r3(0x8b000000, X9, X9, X10);
        break;
      case B_SUB:
        this.r3(0xcb000000, X9, X9, X10);
        break;
      case B_MUL:
        this.emit(0x9b007c00 | (X10 << 16) | (X9 << 5) | X9);
        break;
      case B_SDIV:
      case B_SREM:
        this.signExtend(X9, X9, bits);
        this.signExtend(X10, X10, bits);
        this.r3(0x9ac00c00, X11, X9, X10);
        if (op === B_SREM) this.emit(0x9b008000 | (X10 << 16) | (X9 << 10) | (X11 << 5) | X9);
        else this.movReg(X9, X11);
        break;
      case B_UDIV:
      case B_UREM:
        this.r3(0x9ac00800, X11, X9, X10);
        if (op === B_UREM) this.emit(0x9b008000 | (X10 << 16) | (X9 << 10) | (X11 << 5) | X9);
        else this.movReg(X9, X11);
        break;
      case B_SHL:
        this.r3(0x9ac02000, X9, X9, X10);
        break;
      case B_LSHR:
        this.r3(0x9ac02400, X9, X9, X10);
        break;
      case B_ASHR:
        this.signExtend(X9, X9, bits);
        this.r3(0x9ac02800, X9, X9, X10);
        break;
      case B_AND:
        this.r3(0x8a000000, X9, X9, X10);
        break;
      case B_OR:
        this.r3(0xaa000000, X9, X9, X10);
        break;
      case B_XOR:
        this.r3(0xca000000, X9, X9, X10);
        break;
      default:
        refuse(`binary operator ${op} has no lowering`);
    }
    this.zeroExtend(X9, X9, bits);
    this.store(res, X9);
  }

  // i128 arithmetic: add, sub, mul and the bitwise ones inline, shifts and division by the
  // compiler runtime's helpers.
  wideBinary(this: Mut<this>, op: i64, o0: i64, res: i64): void {
    if (op === B_SHL || op === B_LSHR || op === B_ASHR) {
      this.pair(o0, X0, X1);
      this.pair(o0 + 1, X2, X9);
      this.callNamed(op === B_SHL ? "__ashlti3" : op === B_LSHR ? "__lshrti3" : "__ashrti3");
      this.storePair(res, X0, X1);
      return;
    }
    if (op === B_SDIV || op === B_UDIV || op === B_SREM || op === B_UREM) {
      this.pair(o0, X0, X1);
      this.pair(o0 + 1, X2, 3);
      this.callNamed(op === B_SDIV ? "__divti3" : op === B_UDIV ? "__udivti3" : op === B_SREM ? "__modti3" : "__umodti3");
      this.storePair(res, X0, X1);
      return;
    }
    this.pair(o0, X9, X10);
    this.pair(o0 + 1, X11, X12);
    switch (op) {
      case B_ADD:
        this.r3(0xab000000, X9, X9, X11);
        this.r3(0x9a000000, X10, X10, X12);
        break;
      case B_SUB:
        this.r3(0xeb000000, X9, X9, X11);
        this.r3(0xda000000, X10, X10, X12);
        break;
      case B_MUL:
        // hi = umulh(alo, blo) + alo * bhi + ahi * blo; lo = alo * blo
        this.r3(0x9bc07c00, X13, X9, X11);
        this.emit(0x9b000000 | (X12 << 16) | (X13 << 10) | (X9 << 5) | X13);
        this.emit(0x9b000000 | (X11 << 16) | (X13 << 10) | (X10 << 5) | X13);
        this.emit(0x9b007c00 | (X11 << 16) | (X9 << 5) | X9);
        this.movReg(X10, X13);
        break;
      case B_AND:
        this.r3(0x8a000000, X9, X9, X11);
        this.r3(0x8a000000, X10, X10, X12);
        break;
      case B_OR:
        this.r3(0xaa000000, X9, X9, X11);
        this.r3(0xaa000000, X10, X10, X12);
        break;
      case B_XOR:
        this.r3(0xca000000, X9, X9, X11);
        this.r3(0xca000000, X10, X10, X12);
        break;
      default:
        refuse(`i128 operator ${op} has no lowering`);
    }
    this.storePair(res, X9, X10);
  }

  icmp(this: Mut<this>, pred: i64, o0: i64, res: i64): void {
    const t = this.opType(o0);
    if (t === T_I128) {
      this.wideCompare(pred, o0, res);
      return;
    }
    const bits = this.bits(t);
    this.value(o0, X9);
    this.value(o0 + 1, X10);
    const signedPred = pred === P_SGT || pred === P_SGE || pred === P_SLT || pred === P_SLE;
    if (signedPred && bits < 64) {
      this.signExtend(X9, X9, bits);
      this.signExtend(X10, X10, bits);
    }
    this.cmpReg(X9, X10);
    this.cset(X9, intCondition(pred));
    this.store(res, X9);
  }

  wideCompare(this: Mut<this>, pred: i64, o0: i64, res: i64): void {
    this.pair(o0, X9, X10);
    this.pair(o0 + 1, X11, X12);
    if (pred === P_EQ || pred === P_NE) {
      this.r3(0xca000000, X9, X9, X11);
      this.r3(0xca000000, X10, X10, X12);
      this.r3(0xaa000000, X9, X9, X10);
      this.cmpImm(X9, 0);
      this.cset(X9, pred === P_EQ ? EQ : NE);
      this.store(res, X9);
      return;
    }
    // a < b from the flags of a - b over both words; the others by swapping or inverting.
    const swap = pred === P_SGT || pred === P_UGT || pred === P_SLE || pred === P_ULE;
    if (swap) {
      this.cmpReg(X11, X9);
      this.r3(0xfa000000, ZR, X12, X10);
    } else {
      this.cmpReg(X9, X11);
      this.r3(0xfa000000, ZR, X10, X12);
    }
    const signedPred = pred === P_SGT || pred === P_SGE || pred === P_SLT || pred === P_SLE;
    const less = signedPred ? LT : LO;
    const invert = pred === P_SGE || pred === P_UGE || pred === P_SLE || pred === P_ULE;
    this.cset(X9, invert ? less ^ 1 : less);
    this.store(res, X9);
  }

  fcmp(this: Mut<this>, pred: i64, o0: i64, res: i64): void {
    const t = this.opType(o0);
    const single = this.kind(t) === K_FLOAT;
    if (pred === F_FALSE || pred === F_TRUE) {
      this.movImm(X9, pred === F_TRUE ? 1 : 0);
      this.store(res, X9);
      return;
    }
    this.fvalue(o0, D16, single);
    this.fvalue(o0 + 1, D17, single);
    this.emit((single ? 0x1e202000 : 0x1e602000) | (D17 << 16) | (D16 << 5));
    if (pred === F_ONE || pred === F_UEQ) {
      this.cset(X9, pred === F_ONE ? MI : EQ);
      this.cset(X10, pred === F_ONE ? GT : VS);
      this.r3(0xaa000000, X9, X9, X10);
    } else this.cset(X9, floatCondition(pred));
    this.store(res, X9);
  }

  cast(this: Mut<this>, k: i64, o0: i64, to: i64, res: i64): void {
    const from = this.opType(o0);
    if ((k === C_FPTOSI || k === C_FPTOUI) && to === T_I128) {
      this.wideFromFloat(k === C_FPTOSI, o0, res, false);
      return;
    }
    if (k === C_FPTOSI || k === C_FPTOUI) {
      this.fvalue(o0, D16, this.kind(from) === K_FLOAT);
      this.convertToInt(k === C_FPTOSI, this.kind(from) === K_FLOAT, this.bits(to) > 32, X9, D16);
      this.zeroExtend(X9, X9, this.bits(to));
      this.store(res, X9);
      return;
    }
    if (k === C_SITOFP || k === C_UITOFP) {
      const single = this.kind(to) === K_FLOAT;
      if (from === T_I128) {
        this.pair(o0, X0, X1);
        this.callNamed(k === C_SITOFP ? (single ? "__floattisf" : "__floattidf") : (single ? "__floatuntisf" : "__floatuntidf"));
        this.fstore(res, 0, single);
        return;
      }
      this.value(o0, X9);
      if (k === C_SITOFP) this.signExtend(X9, X9, this.bits(from));
      // scvtf/ucvtf from x
      this.emit((k === C_SITOFP ? (single ? 0x9e220000 : 0x9e620000) : (single ? 0x9e230000 : 0x9e630000)) | (X9 << 5) | D16);
      this.fstore(res, D16, single);
      return;
    }
    if (k === C_FPEXT) {
      this.fvalue(o0, D16, true);
      this.emit(0x1e22c000 | (D16 << 5) | D16);
      this.fstore(res, D16, false);
      return;
    }
    if (k === C_FPTRUNC) {
      this.fvalue(o0, D16, false);
      this.emit(0x1e624000 | (D16 << 5) | D16);
      this.fstore(res, D16, true);
      return;
    }
    if (to === T_I128) {
      this.value(o0, X9);
      if (from === T_I128) {
        this.pair(o0, X9, X10);
      } else if (k === C_SEXT) {
        this.signExtend(X9, X9, this.bits(from));
        this.asrImm(X10, X9, 63);
      } else this.movImm(X10, 0);
      this.storePair(res, X9, X10);
      return;
    }
    if (from === T_I128) {
      this.pair(o0, X9, X10);
      this.zeroExtend(X9, X9, this.bits(to));
      this.store(res, X9);
      return;
    }
    this.value(o0, X9);
    if (k === C_SEXT) this.signExtend(X9, X9, this.bits(from));
    if (!this.isFloat(to)) this.zeroExtend(X9, X9, this.bits(to));
    this.store(res, X9);
  }

  // A float to i128 through the compiler runtime, which saturates; a NaN gives 0 when `nanZero`.
  wideFromFloat(this: Mut<this>, signedTo: boolean, o: i64, res: i64, nanZero: boolean): void {
    const single = this.kind(this.opType(o)) === K_FLOAT;
    this.fvalue(o, 0, single);
    this.callNamed(signedTo ? (single ? "__fixsfti" : "__fixdfti") : (single ? "__fixunssfti" : "__fixunsdfti"));
    if (nanZero) {
      this.fvalue(o, D16, single);
      this.emit((single ? 0x1e202000 : 0x1e602000) | (D16 << 16) | (D16 << 5));
      this.csel(X0, ZR, X0, VS);
      this.csel(X1, ZR, X1, VS);
    }
    this.storePair(res, X0, X1);
  }

  // fcvtzs/fcvtzu from d (or s) into x (or w), both saturating.
  convertToInt(this: Mut<this>, signedTo: boolean, single: boolean, wide: boolean, rd: i64, d: i64): void {
    let base: i64 = signedTo ? 0x1e780000 : 0x1e790000;
    if (single) base = base & ~0x00400000;
    if (wide) base = base | 0x80000000;
    this.emit(base | (d << 5) | rd);
  }

  select(this: Mut<this>, o0: i64, ty: i64, res: i64): void {
    if (res < 0) return;
    if (this.isAgg(ty)) {
      const otherwise = this.newLabel();
      const done = this.newLabel();
      this.value(o0, X16);
      this.cbz(X16, otherwise);
      this.put(o0 + 1, SP, this.slotOf(res));
      this.b(done);
      this.bind(otherwise);
      this.put(o0 + 2, SP, this.slotOf(res));
      this.bind(done);
      return;
    }
    if (ty === T_I128) {
      this.pair(o0 + 1, X9, X10);
      this.pair(o0 + 2, X11, X12);
      this.value(o0, X13);
      this.cmpImm(X13, 0);
      this.csel(X9, X9, X11, NE);
      this.csel(X10, X10, X12, NE);
      this.storePair(res, X9, X10);
      return;
    }
    this.value(o0 + 1, X10);
    this.value(o0 + 2, X11);
    this.value(o0, X9);
    this.cmpImm(X9, 0);
    this.csel(X9, X10, X11, NE);
    this.store(res, X9);
  }

  // ---- control flow

  // Whether the edge from the current block to `to` copies into phis.
  hasPhis(to: i64): boolean {
    return this.phiCount[to as usize]! > 0;
  }

  // The copies on the edge from `from` into `to`'s phis' shadows.
  edge(this: Mut<this>, from: i64, to: i64): void {
    const first = this.phiFirst[to as usize]!;
    const count = this.phiCount[to as usize]!;
    for (let k: i64 = 0; k < count; k++) {
      const i = first + k;
      const r = this.ir.f.ires[i as usize]!;
      if (r < 0) continue;
      const o0 = this.ir.f.ifirst[i as usize]!;
      const n = this.ir.f.icount[i as usize]!;
      let found = -1;
      for (let j: i64 = 0; j < n; j += 2) {
        if (this.opValue(o0 + j + 1) === from) {
          found = o0 + j;
          break;
        }
      }
      if (found < 0) refuse("a phi with no value for an edge");
      this.toSlot(found, this.shadow[r as usize]!);
    }
  }

  jump(this: Mut<this>, to: i64): void {
    if (this.hasPhis(to)) this.edge(this.current, to);
    this.b(to);
  }

  // A branch target for an edge: the block itself, or a stub that copies into its phis first.
  edgeTarget(this: Mut<this>, to: i64, stubs: Mut<i64[]>): i64 {
    if (!this.hasPhis(to)) return to;
    const l = this.newLabel();
    stubs.push(l);
    stubs.push(to);
    return l;
  }

  stubs(this: Mut<this>, stubs: Ref<i64[]>): void {
    for (let k: usize = 0; k < stubs.length; k += 2) {
      this.bind(stubs[k]!);
      this.edge(this.current, stubs[k + 1]!);
      this.b(stubs[k + 1]!);
    }
  }

  condbr(this: Mut<this>, o0: i64): void {
    const yes = this.opValue(o0 + 1);
    const no = this.opValue(o0 + 2);
    let stubs: i64[] = [];
    if (this.opKind(o0) !== O_LOCAL) {
      const taken = this.opKind(o0) === O_INT && (this.opValue(o0) & 1) === 1;
      this.jump(taken ? yes : no);
      return;
    }
    this.value(o0, X9);
    const target = this.edgeTarget(yes, stubs);
    this.cbnz(X9, target);
    this.jump(no);
    this.stubs(stubs);
  }

  switchOn(this: Mut<this>, i: i64, o0: i64): void {
    const n = this.ir.f.icount[i as usize]!;
    const t = this.opType(o0);
    let stubs: i64[] = [];
    this.value(o0, X9);
    for (let k: i64 = 2; k + 1 < n; k += 2) {
      const c = this.opKind(o0 + k) === O_ZERO ? 0 : this.opValue(o0 + k);
      this.cmpImm(X9, masked64(c, this.bits(t)));
      const target = this.edgeTarget(this.opValue(o0 + k + 1), stubs);
      this.bcond(EQ, target);
    }
    this.jump(this.opValue(o0 + 1));
    this.stubs(stubs);
  }

  ret(this: Mut<this>, o0: i64, ty: i64): void {
    if (ty !== T_VOID) {
      if (this.isAgg(ty)) {
        this.mem(LDRX, X16, SP, this.sret);
        this.put(o0, X16, 0);
      } else if (ty === T_I128) this.pair(o0, X0, X1);
      else if (this.isFloat(ty)) this.fvalue(o0, 0, this.kind(ty) === K_FLOAT);
      else this.value(o0, X0);
    }
    this.emit(0x910003bf);
    this.emit(0xa8c17bfd);
    this.emit(0xd65f03c0);
  }

  // ---- calls

  call(this: Mut<this>, i: i64): void {
    const o0 = this.operandOf(i, 0);
    const res = this.ir.f.ires[i as usize]!;
    const ty = this.ir.f.ity[i as usize]!;
    const invoke = this.ir.f.iop[i as usize]! === I_INVOKE;
    const count = this.callArgs(i);
    if (this.opKind(o0) === O_SYM && this.ir.isIntrinsic(this.opValue(o0))) {
      if (invoke) refuse("an invoked intrinsic");
      this.intrinsic(this.ir.symbolText(this.opValue(o0)), o0, res, ty);
      return;
    }
    const places = this.arguments(i);
    // Aggregate arguments made from constants get their temporaries first, then the stack
    // arguments are stored, then the registers loaded, so nothing clobbers an argument register.
    let aggAt: i64[] = new Array(count as usize).fill(-1 as i64);
    for (let k: i64 = 0; k < count; k++) {
      const o = o0 + 1 + k;
      if (this.isAgg(this.opType(o))) aggAt[k as usize] = this.aggregate(o);
    }
    for (let k: i64 = 0; k < count; k++) {
      const p = places[k as usize]!;
      if (p < 64) continue;
      const o = o0 + 1 + k;
      const t = this.opType(o);
      if (this.isAgg(t)) {
        this.addImm(X9, SP, aggAt[k as usize]!);
        this.mem(STRX, X9, SP, p - 64);
      } else if (t === T_I128) {
        this.pair(o, X9, X10);
        this.mem(STRX, X9, SP, p - 64);
        this.mem(STRX, X10, SP, p - 64 + 8);
      } else {
        this.value(o, X9);
        const fixed = this.ir.f.iaux2[i as usize]!;
        const variadic = fixed >= 0 && k >= fixed;
        this.mem(variadic ? STRX : this.storeOp(this.size(t)), X9, SP, p - 64);
      }
    }
    for (let k: i64 = 0; k < count; k++) {
      const p = places[k as usize]!;
      if (p >= 64) continue;
      const o = o0 + 1 + k;
      const t = this.opType(o);
      if (p >= 32) this.fvalue(o, p - 32, this.kind(t) === K_FLOAT);
      else if (this.isAgg(t)) this.addImm(p, SP, aggAt[k as usize]!);
      else if (t === T_I128) this.pair(o, p, p + 1);
      else this.value(o, p);
    }
    let sretAt: i64 = -1;
    if (this.isAgg(ty)) {
      sretAt = res >= 0 ? this.slotOf(res) : this.scratch(this.size(ty), this.ir.talign[ty as usize]!);
      this.addImm(X8, SP, sretAt);
    }
    if (this.opKind(o0) === O_SYM && this.opExtra(o0) === 0 && !this.ir.symTls[this.opValue(o0) as usize]!) {
      this.bl(this.opValue(o0));
    } else {
      this.value(o0, X16);
      this.emit(0xd63f0000 | (X16 << 5));
      this.page = -1;
    }
    const after = o0 + 1 + count;
    if (invoke) {
      this.siteAt.push(this.here() - 1);
      this.siteLabel.push(this.opValue(after + 1));
    }
    if (res >= 0 && !this.isAgg(ty)) {
      if (ty === T_I128) this.storePair(res, X0, X1);
      else if (this.isFloat(ty)) this.fstore(res, 0, this.kind(ty) === K_FLOAT);
      else {
        this.zeroExtend(X0, X0, this.bits(ty));
        this.store(res, X0);
      }
    }
    if (invoke) this.jump(this.opValue(after));
  }

  intrinsic(this: Mut<this>, name: string, o0: i64, res: i64, ty: i64): void {
    if (name.startsWith("llvm.sadd.with.overflow.") || name.startsWith("llvm.uadd.with.overflow.") || name.startsWith("llvm.ssub.with.overflow.") || name.startsWith("llvm.usub.with.overflow.") || name.startsWith("llvm.smul.with.overflow.") || name.startsWith("llvm.umul.with.overflow.")) {
      this.overflow(name.slice(5, 9), o0, res, ty);
      return;
    }
    if (name.startsWith("llvm.sadd.sat.") || name.startsWith("llvm.uadd.sat.") || name.startsWith("llvm.ssub.sat.") || name.startsWith("llvm.usub.sat.")) {
      this.saturate(name, o0, res, ty);
      return;
    }
    if (name.startsWith("llvm.memcpy.") || name.startsWith("llvm.memmove.") || name.startsWith("llvm.memset.")) {
      this.value(o0 + 1, X0);
      this.value(o0 + 2, X1);
      this.value(o0 + 3, X2);
      this.callNamed(name.startsWith("llvm.memcpy.") ? "memcpy" : name.startsWith("llvm.memmove.") ? "memmove" : "memset");
      return;
    }
    if (name.startsWith("llvm.lifetime.") || name.startsWith("llvm.dbg.") || name === "llvm.assume") return;
    if (name.startsWith("llvm.expect.")) {
      this.value(o0 + 1, X9);
      this.store(res, X9);
      return;
    }
    if (name === "llvm.trap" || name === "llvm.debugtrap") {
      this.brk();
      return;
    }
    if ((name.startsWith("llvm.fptosi.sat.") || name.startsWith("llvm.fptoui.sat.")) && ty === T_I128) {
      this.wideFromFloat(name.startsWith("llvm.fptosi.sat."), o0 + 1, res, true);
      return;
    }
    if (name.startsWith("llvm.fptosi.sat.") || name.startsWith("llvm.fptoui.sat.")) {
      const s = name.startsWith("llvm.fptosi.sat.");
      const from = this.opType(o0 + 1);
      const single = this.kind(from) === K_FLOAT;
      const bits = this.bits(ty);
      this.fvalue(o0 + 1, D16, single);
      this.convertToInt(s, single, bits > 32, X9, D16);
      if (bits < 32) {
        // Clamped to the narrower range.
        const hi: i64 = s ? (1 << (bits - 1)) - 1 : (1 << bits) - 1;
        this.movImm(X10, hi);
        if (s) this.signExtend(X9, X9, 32);
        this.cmpReg(X9, X10);
        this.csel(X9, X10, X9, s ? GT : HI);
        if (s) {
          this.movImm(X10, 0 - (1 << (bits - 1)));
          this.cmpReg(X9, X10);
          this.csel(X9, X10, X9, LT);
        }
      }
      this.zeroExtend(X9, X9, bits);
      this.store(res, X9);
      return;
    }
    const unary = ["llvm.floor.", "llvm.ceil.", "llvm.trunc.", "llvm.round.", "llvm.sqrt.", "llvm.fabs.", "llvm.rint.", "llvm.nearbyint.", "llvm.roundeven."];
    const ops: i64[] = [0x1e654000, 0x1e64c000, 0x1e65c000, 0x1e664000, 0x1e61c000, 0x1e60c000, 0x1e674000, 0x1e67c000, 0x1e644000];
    for (let k: usize = 0; k < unary.length; k++) {
      if (!name.startsWith(unary[k]!)) continue;
      const single = this.kind(ty) === K_FLOAT;
      this.fvalue(o0 + 1, D16, single);
      this.emit((single ? ops[k]! & ~0x00400000 : ops[k]!) | (D16 << 5) | D16);
      this.fstore(res, D16, single);
      return;
    }
    if (name.startsWith("llvm.minnum.") || name.startsWith("llvm.maxnum.") || name.startsWith("llvm.minimum.") || name.startsWith("llvm.maximum.")) {
      const single = this.kind(ty) === K_FLOAT;
      this.fvalue(o0 + 1, D16, single);
      this.fvalue(o0 + 2, D17, single);
      let base: i64 = name.startsWith("llvm.minnum.") ? 0x1e607800 : name.startsWith("llvm.maxnum.") ? 0x1e606800 : name.startsWith("llvm.minimum.") ? 0x1e605800 : 0x1e604800;
      if (single) base = base & ~0x00400000;
      this.r3(base, D16, D16, D17);
      this.fstore(res, D16, single);
      return;
    }
    if (name.startsWith("llvm.copysign.")) {
      // The magnitude's bits with the sign's top bit.
      const single = this.kind(ty) === K_FLOAT;
      this.value(o0 + 1, X9);
      this.value(o0 + 2, X10);
      const top: i64 = single ? 31 : 63;
      this.zeroExtend(X9, X9, top);
      this.lsrImm(X10, X10, top);
      // orr x9, x9, x10, lsl #top
      this.emit(0xaa000000 | (X10 << 16) | (top << 10) | (X9 << 5) | X9);
      this.store(res, X9);
      return;
    }
    if (name.startsWith("llvm.smax.") || name.startsWith("llvm.smin.") || name.startsWith("llvm.umax.") || name.startsWith("llvm.umin.")) {
      const bits = this.bits(ty);
      this.value(o0 + 1, X9);
      this.value(o0 + 2, X10);
      const s = name.startsWith("llvm.sm");
      if (s) {
        this.signExtend(X9, X9, bits);
        this.signExtend(X10, X10, bits);
      }
      this.cmpReg(X9, X10);
      const max = name.slice(6, 9) === "max";
      this.csel(X9, X9, X10, max ? (s ? GT : HI) : (s ? LT : LO));
      this.zeroExtend(X9, X9, bits);
      this.store(res, X9);
      return;
    }
    if (name.startsWith("llvm.abs.")) {
      const bits = this.bits(ty);
      this.value(o0 + 1, X9);
      this.signExtend(X9, X9, bits);
      this.r3(0xcb000000, X10, ZR, X9);
      this.cmpImm(X9, 0);
      this.csel(X9, X10, X9, LT);
      this.zeroExtend(X9, X9, bits);
      this.store(res, X9);
      return;
    }
    if (name.startsWith("llvm.ctlz.") || name.startsWith("llvm.cttz.") || name.startsWith("llvm.bswap.") || name.startsWith("llvm.ctpop.") || name.startsWith("llvm.bitreverse.")) {
      const bits = this.bits(ty);
      this.value(o0 + 1, X9);
      if (name.startsWith("llvm.ctlz.")) {
        this.emit(0xdac01000 | (X9 << 5) | X9);
        if (bits < 64) this.addImm(X9, X9, bits - 64);
      } else if (name.startsWith("llvm.cttz.")) {
        // A bit past the width keeps a zero input at `bits`.
        if (bits < 64) {
          this.movImm(X10, 1);
          this.emit(0xd3400000 | (((64 - bits) & 63) << 16) | ((63 - bits) << 10) | (X10 << 5) | X10);
          this.r3(0xaa000000, X9, X9, X10);
        }
        this.emit(0xdac00000 | (X9 << 5) | X9);
        this.emit(0xdac01000 | (X9 << 5) | X9);
      } else if (name.startsWith("llvm.bswap.")) {
        this.emit(0xdac00c00 | (X9 << 5) | X9);
        if (bits < 64) this.lsrImm(X9, X9, 64 - bits);
      } else if (name.startsWith("llvm.bitreverse.")) {
        this.emit(0xdac00000 | (X9 << 5) | X9);
        if (bits < 64) this.lsrImm(X9, X9, 64 - bits);
      } else {
        // fmov d16, x9; cnt v16.8b, v16.8b; addv b16, v16.8b; fmov w9, s16
        this.emit(0x9e670000 | (X9 << 5) | D16);
        this.emit(0x0e205800 | (D16 << 5) | D16);
        this.emit(0x0e31b800 | (D16 << 5) | D16);
        this.emit(0x1e260000 | (D16 << 5) | X9);
      }
      this.zeroExtend(X9, X9, bits);
      this.store(res, X9);
      return;
    }
    refuse(`the intrinsic ${name} has no lowering`);
  }

  // `{ iN, i1 }` from the checked arithmetic intrinsics, for N up to 64.
  overflow(this: Mut<this>, which: string, o0: i64, res: i64, ty: i64): void {
    const t = this.opType(o0 + 1);
    if (t === T_I128) {
      this.wideOverflow(which, o0);
      if (res < 0) return;
      const at = this.slotOf(res);
      this.mem(STRX, X11, SP, at);
      this.mem(STRX, X13, SP, at + 8);
      this.mem(STRB, X12, SP, at + this.ir.fieldOffset(ty, 1));
      return;
    }
    const bits = this.bits(t);
    this.value(o0 + 1, X9);
    this.value(o0 + 2, X10);
    const s = which[0]! === "s";
    const kind = which.slice(1);
    if (bits === 64 || bits === 32) {
      const w = bits === 32;
      const sf: i64 = w ? 0 : 0x80000000;
      if (kind === "add" || kind === "sub") {
        // adds/subs
        this.r3((kind === "add" ? 0x2b000000 : 0x6b000000) | sf, X11, X9, X10);
        this.cset(X12, s ? VS : kind === "add" ? HS : LO);
      } else if (!s) {
        if (w) {
          // umull x11, w9, w10; overflow when the high half isn't 0
          this.r3(0x9ba07c00, X11, X9, X10);
          this.lsrImm(X12, X11, 32);
        } else {
          this.emit(0x9b007c00 | (X10 << 16) | (X9 << 5) | X11);
          this.r3(0x9bc07c00, X12, X9, X10);
        }
        this.cmpImm(X12, 0);
        this.cset(X12, NE);
      } else {
        if (w) {
          this.r3(0x9b207c00, X11, X9, X10);
          this.signExtend(X12, X11, 32);
          this.cmpReg(X12, X11);
        } else {
          this.emit(0x9b007c00 | (X10 << 16) | (X9 << 5) | X11);
          this.r3(0x9b407c00, X12, X9, X10);
          // cmp x12, x11, asr #63
          this.emit(0xeb800000 | (X11 << 16) | (63 << 10) | (X12 << 5) | ZR);
        }
        this.cset(X12, NE);
      }
    } else {
      if (s) {
        this.signExtend(X9, X9, bits);
        this.signExtend(X10, X10, bits);
      }
      if (kind === "add") this.r3(0x8b000000, X11, X9, X10);
      else if (kind === "sub") this.r3(0xcb000000, X11, X9, X10);
      else this.emit(0x9b007c00 | (X10 << 16) | (X9 << 5) | X11);
      if (s) {
        this.signExtend(X12, X11, bits);
        this.cmpReg(X12, X11);
        this.cset(X12, NE);
      } else if (kind === "sub") {
        this.cmpReg(X9, X10);
        this.cset(X12, LO);
      } else {
        this.lsrImm(X12, X11, bits);
        this.cmpImm(X12, 0);
        this.cset(X12, NE);
      }
    }
    if (res < 0) return;
    const at = this.slotOf(res);
    this.mem(this.storeOp(this.size(t)), X11, SP, at);
    this.mem(STRB, X12, SP, at + this.ir.fieldOffset(ty, 1));
  }

  // An i128 add, sub or mul with overflow: the result in x11 (low) and x13 (high), the flag in x12.
  wideOverflow(this: Mut<this>, which: string, o0: i64): void {
    const s = which[0]! === "s";
    const kind = which.slice(1);
    if (kind === "mul") {
      if (s) {
        // __muloti4(a, b, &overflow), the flag a word in the frame.
        const flag = this.scratch(8, 8);
        this.pair(o0 + 1, X0, X1);
        this.pair(o0 + 2, X2, 3);
        this.addImm(4, SP, flag);
        this.callNamed("__muloti4");
        this.movReg(X11, X0);
        this.movReg(X13, X1);
        this.mem(LDRW, X12, SP, flag);
        this.cmpImm(X12, 0);
        this.cset(X12, NE);
        return;
      }
      this.pair(o0 + 1, X9, X10);
      this.pair(o0 + 2, X11, X12);
      // Overflow when both high words are set, when either cross product's high word is, or when
      // the high word's sum carries.
      this.cmpImm(X10, 0);
      this.cset(14, NE);
      this.cmpImm(X12, 0);
      this.cset(15, NE);
      this.r3(0x8a000000, 14, 14, 15);
      this.r3(0x9bc07c00, 15, X10, X11);
      this.cmpImm(15, 0);
      this.cset(15, NE);
      this.r3(0xaa000000, 14, 14, 15);
      this.r3(0x9bc07c00, 15, X9, X12);
      this.cmpImm(15, 0);
      this.cset(15, NE);
      this.r3(0xaa000000, 14, 14, 15);
      // mid = ahi * blo + alo * bhi, with its carry
      this.emit(0x9b007c00 | (X11 << 16) | (X10 << 5) | X13);
      this.emit(0x9b007c00 | (X12 << 16) | (X9 << 5) | 15);
      this.r3(0xab000000, X13, X13, 15);
      this.cset(15, HS);
      this.r3(0xaa000000, 14, 14, 15);
      // hi = umulh(alo, blo) + mid, with its carry
      this.r3(0x9bc07c00, 15, X9, X11);
      this.r3(0xab000000, X13, X13, 15);
      this.cset(15, HS);
      this.r3(0xaa000000, X12, 14, 15);
      this.emit(0x9b007c00 | (X11 << 16) | (X9 << 5) | X11);
      return;
    }
    this.pair(o0 + 1, X9, X10);
    this.pair(o0 + 2, X11, X12);
    if (kind === "add") {
      this.r3(0xab000000, X11, X9, X11);
      this.r3(0xba000000, X13, X10, X12);
      this.cset(X12, s ? VS : HS);
    } else {
      this.r3(0xeb000000, X11, X9, X11);
      this.r3(0xfa000000, X13, X10, X12);
      this.cset(X12, s ? VS : LO);
    }
  }

  // `llvm.[su]{add,sub}.sat.iN`: the result clamped to the type's range.
  saturate(this: Mut<this>, name: string, o0: i64, res: i64, ty: i64): void {
    const s = name[5]! === "s";
    const add = name.slice(6, 9) === "add";
    if (ty === T_I128) {
      this.wideOverflow(`${s ? "s" : "u"}${add ? "add" : "sub"}`, o0);
      if (s) {
        // The bound has the first operand's sign: MAX when it is not negative, MIN when it is.
        this.pair(o0 + 1, X9, X10);
        this.asrImm(X14, X10, 63);
        this.movImm(15, 0x7fffffffffffffff);
        this.r3(0xca000000, 15, 15, X14);
        this.r3(0xca200000, X14, X14, ZR);
        this.cmpImm(X12, 0);
        this.csel(X11, X14, X11, NE);
        this.csel(X13, 15, X13, NE);
      } else {
        this.cmpImm(X12, 0);
        this.movImm(X14, add ? -1 : 0);
        this.csel(X11, X14, X11, NE);
        this.csel(X13, X14, X13, NE);
      }
      this.storePair(res, X11, X13);
      return;
    }
    const bits = this.bits(ty);
    this.value(o0 + 1, X9);
    this.value(o0 + 2, X10);
    if (bits === 64) {
      if (s) {
        this.asrImm(X12, X9, 63);
        this.movImm(X13, 0x7fffffffffffffff);
        this.r3(0xca000000, X12, X12, X13);
        this.r3(add ? 0xab000000 : 0xeb000000, X11, X9, X10);
        this.csel(X11, X12, X11, VS);
      } else if (add) {
        this.r3(0xab000000, X11, X9, X10);
        // csinv x11, x11, xzr, lo
        this.emit(0xda800000 | (ZR << 16) | (LO << 12) | (X11 << 5) | X11);
      } else {
        this.r3(0xeb000000, X11, X9, X10);
        this.csel(X11, X11, ZR, HS);
      }
      this.store(res, X11);
      return;
    }
    if (s) {
      this.signExtend(X9, X9, bits);
      this.signExtend(X10, X10, bits);
    }
    this.r3(add ? 0x8b000000 : 0xcb000000, X11, X9, X10);
    if (s) {
      this.movImm(X12, (1 << (bits - 1)) - 1);
      this.cmpReg(X11, X12);
      this.csel(X11, X12, X11, GT);
      this.movImm(X12, 0 - (1 << (bits - 1)));
      this.cmpReg(X11, X12);
      this.csel(X11, X12, X11, LT);
    } else if (add) {
      this.movImm(X12, (1 << bits) - 1);
      this.cmpReg(X11, X12);
      this.csel(X11, X12, X11, HI);
    } else {
      this.cmpReg(X9, X10);
      this.csel(X11, ZR, X11, LO);
    }
    this.zeroExtend(X11, X11, bits);
    this.store(res, X11);
  }

  rmw(this: Mut<this>, op: i64, o0: i64, ty: i64, res: i64): void {
    const a = this.address(o0);
    if (a[0]! === SP) this.addImm(X16, SP, a[1]!);
    this.value(o0 + 1, X10);
    const log = this.log2(this.size(ty));
    const sz = log << 30;
    if (op === R_NAND) {
      // A compare-and-swap loop: x9 the old value, x11 the new.
      const again = this.newLabel();
      this.mem(this.loadOp(this.size(ty)), X9, X16, 0);
      this.bind(again);
      this.movReg(X12, X9);
      this.r3(0x8a000000, X11, X9, X10);
      this.r3(0xaa200000, X11, ZR, X11);
      this.emit(0x08e0fc00 | sz | (X9 << 16) | (X16 << 5) | X11);
      this.cmpReg(X9, X12);
      this.bcond(NE, again);
    } else {
      let base: i64 = 0;
      if (op === R_XCHG) base = 0x38e08000;
      else if (op === R_ADD || op === R_SUB) base = 0x38e00000;
      else if (op === R_AND) base = 0x38e01000;
      else if (op === R_XOR) base = 0x38e02000;
      else if (op === R_OR) base = 0x38e03000;
      else if (op === R_MAX) base = 0x38e04000;
      else if (op === R_MIN) base = 0x38e05000;
      else if (op === R_UMAX) base = 0x38e06000;
      else base = 0x38e07000;
      if (op === R_SUB) this.r3(0xcb000000, X10, ZR, X10);
      // ldclr clears the bits set, so and takes the complement.
      if (op === R_AND) this.r3(0xaa200000, X10, ZR, X10);
      if ((op === R_MAX || op === R_MIN) && log < 3) refuse("a narrow signed atomic min or max");
      this.emit(base | sz | (X10 << 16) | (X16 << 5) | X9);
    }
    this.zeroExtend(X9, X9, this.bits(ty));
    this.store(res, X9);
  }

  // ---- the unit

  // Every function in the unit, lowered.
  unit(this: Mut<this>, defines: Ref<usize[]>): void {
    for (const d of defines) {
      this.ir.func(d);
      this.func();
    }
  }
}

const I64_MAX: i64 = 9_223_372_036_854_775_807;

// A value seen at `place`: its range widened to hold it.
function touch(lo: Mut<i64[]>, hi: Mut<i64[]>, v: i64, place: i64): void {
  if (place < lo[v as usize]!) lo[v as usize] = place;
  if (place > hi[v as usize]!) hi[v as usize] = place;
}

// A slot given back to the free slots of its key.
function release(free: Mut<Map<i64, i64[]>>, key: i64, at: i64): void {
  const had = free.get(key);
  if (had !== undefined) {
    let l: i64[] = had;
    l.push(at);
    free.set(key, l);
    return;
  }
  free.set(key, [at]);
}

// A value's home after one more sight of it in block `b`.
function placed(home: i64, b: i64): i64 {
  if (home === -2) return b;
  return home === b ? b : -1;
}

// The condition after `cmp a, b` for an integer predicate.
function intCondition(pred: i64): i64 {
  if (pred === P_EQ) return EQ;
  if (pred === P_NE) return NE;
  if (pred === P_UGT) return HI;
  if (pred === P_UGE) return HS;
  if (pred === P_ULT) return LO;
  if (pred === P_ULE) return LS;
  if (pred === P_SGT) return GT;
  if (pred === P_SGE) return GE;
  if (pred === P_SLT) return LT;
  return LE;
}

// The condition after `fcmp a, b` for a float predicate, unordered results included.
function floatCondition(pred: i64): i64 {
  if (pred === F_OEQ) return EQ;
  if (pred === F_OGT) return GT;
  if (pred === F_OGE) return GE;
  if (pred === F_OLT) return MI;
  if (pred === F_OLE) return LS;
  if (pred === F_ORD) return VC;
  if (pred === F_UGT) return HI;
  if (pred === F_UGE) return PL;
  if (pred === F_ULT) return LT;
  if (pred === F_ULE) return LE;
  if (pred === F_UNE) return NE;
  return VS;
}

// A constant zero-extended past `bits`, sign-extended back to 64 for use as a GEP index.
function signed(v: i64, bits: i64): i64 {
  if (bits >= 64) return v;
  const shift = 64 - bits;
  return (v << shift) >> shift;
}

function masked64(v: i64, bits: i64): i64 {
  if (bits >= 64) return v;
  if (bits === 32) return v & 0xffffffff;
  return v & ((1 << bits) - 1);
}

export function uleb(out: Mut<u8[]>, v: i64): void {
  let x = v;
  while (true) {
    const b = x & 0x7f;
    x = x >> 7;
    if (x === 0) {
      out.push(b as u8);
      return;
    }
    out.push((b | 0x80) as u8);
  }
}
