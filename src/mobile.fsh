// `fishc build --mobile`: a Fish file's exports as an iOS, Android or React Native module. Every
// platform calls one C ABI: a generated entry imports the file's exported functions and exports
// `fishmobile_<name>` for each, taking a string as its UTF-8 bytes and length and a boolean as an
// i32, and handing a string result to the glue, which keeps it per thread until the wrapper reads
// it with `fishmobile_result`. Swift calls that ABI directly, Kotlin through JNI glue, and React
// Native through a C++ Turbo Module.
import { CompileError } from "./diag.fsh";
import type { Ids } from "./nodes.fsh";
import { parse, type Func, type Stmt, type TypeNode } from "./parser.fsh";

// How a type crossing is spelled: Fish's name, C's, Swift's, Kotlin's in the wrapper and in its
// external declaration, and JNI's. isize and usize are 64 bits, as on every target built.
const TYPES: [string, string, string, string, string, string][] = [
  ["i8", "int8_t", "Int8", "Byte", "Byte", "jbyte"],
  ["i16", "int16_t", "Int16", "Short", "Short", "jshort"],
  ["i32", "int32_t", "Int32", "Int", "Int", "jint"],
  ["i64", "int64_t", "Int64", "Long", "Long", "jlong"],
  ["u8", "uint8_t", "UInt8", "UByte", "Byte", "jbyte"],
  ["u16", "uint16_t", "UInt16", "UShort", "Short", "jshort"],
  ["u32", "uint32_t", "UInt32", "UInt", "Int", "jint"],
  ["u64", "uint64_t", "UInt64", "ULong", "Long", "jlong"],
  ["isize", "int64_t", "Int", "Long", "Long", "jlong"],
  ["usize", "uint64_t", "UInt", "ULong", "Long", "jlong"],
  ["f32", "float", "Float", "Float", "Float", "jfloat"],
  ["f64", "double", "Double", "Double", "Double", "jdouble"],
  ["boolean", "int32_t", "Bool", "Boolean", "Boolean", "jboolean"],
  ["string", "", "String", "String", "ByteArray", "jbyteArray"],
  ["void", "void", "Void", "Unit", "Unit", "void"],
];

// The ranges JavaScript's numbers hold each integer type in exactly, as the addon checks them.
const RANGES: [string, string, string][] = [
  ["i8", "-128", "127"], ["i16", "-32768", "32767"], ["i32", "-2147483648", "2147483647"], ["u8", "0", "255"], ["u16", "0", "65535"], ["u32", "0", "4294967295"],
  ["i64", "-9007199254740991", "9007199254740991"], ["isize", "-9007199254740991", "9007199254740991"], ["u64", "0", "9007199254740991"], ["usize", "0", "9007199254740991"],
];

const SWIFT_KEYWORDS = new Set(["associatedtype", "class", "deinit", "enum", "extension", "fileprivate", "func", "import", "init", "inout", "internal", "let", "open", "operator", "private", "protocol", "public", "rethrows", "static", "struct", "subscript", "typealias", "var", "break", "case", "continue", "default", "defer", "do", "else", "fallthrough", "for", "guard", "if", "in", "repeat", "return", "switch", "where", "while", "as", "Any", "catch", "false", "is", "nil", "super", "self", "Self", "throw", "throws", "true", "try"]);
const KOTLIN_KEYWORDS = new Set(["as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface", "is", "null", "object", "package", "return", "super", "this", "throw", "true", "try", "typealias", "typeof", "val", "var", "when", "while"]);

type Param = { name: string; type: string };
type Export = { name: string; params: Param[]; returns: string };

// What the build writes: the entry and C glue the library is built from, then each platform's files.
export type Mobile = { name: string; fish: string; glue: string; header: string; modulemap: string; swift: string; jni: string; kotlin: string; module: string; spec: string };

const CROSSING = "a mobile module passes integers, f32, f64, boolean and string";

/** @throws {CompileError} */
function typeOf(t: Ref<TypeNode>): string {
  if (t.kind === "ref" && t.args.length === 0 && TYPES.some((r) => r[0] === t.name)) return t.name;
  const what = t.kind === "ref" ? `'${t.name}'` : "this type";
  throw new CompileError("E1003", `a mobile module can't pass ${what}; ${CROSSING}`, t.start, t.end);
}

/** @throws {CompileError} */
function exportsOf(program: Ref<Stmt[]>): Export[] {
  let found: Export[] = [];
  for (const s of program) {
    if (s.kind !== "export" || s.body.kind !== "function") continue;
    const f: Ref<Func> = s.body;
    if (f.body === undefined) continue;
    if (f.typeParams.length > 0) throw new CompileError("E1003", "a mobile module can't export a generic function; export one for each type", f.start, f.end);
    if (f.async || f.generator) throw new CompileError("E1003", "a mobile module's exports are called synchronously; export a function that isn't async or a generator", f.start, f.end);
    if (f.throws !== undefined) throw new CompileError("E1003", `'${f.name}' throws, which Swift and Kotlin can't catch from Fish; catch the error in Fish and return a value saying what failed`, f.start, f.end);
    if (f.returnType === undefined) throw new CompileError("E1003", `'${f.name}' needs its return type written to be exported, 'void' if it returns nothing`, f.start, f.end);
    let params: Param[] = [];
    for (const p of f.params) {
      if (p.pattern.kind !== "ident" || p.type === undefined || p.rest || p.optional || p.default !== undefined) throw new CompileError("E1003", "a mobile module's exported function takes plain named parameters with their types written, like 'x: f64'", p.start, p.end);
      const t = typeOf(p.type!);
      if (t === "void") throw new CompileError("E1003", "'void' can't be a parameter; leave the parameter out", p.start, p.end);
      params.push({ name: p.pattern.name, type: t });
    }
    found.push({ name: f.name, params, returns: typeOf(f.returnType!) });
  }
  if (found.length === 0) throw new CompileError("E1003", "a mobile module has nothing to call; mark functions with 'export'", 0, 0);
  return found;
}

function row(t: string): [string, string, string, string, string, string] {
  return TYPES.find((r) => r[0] === t)!.clone();
}

// The file's name as a type: `my_lib` is `MyLib`, and one starting with a digit is `Fish...`.
export function typeName(name: string): string {
  let out = "";
  for (const part of name.split(/[^A-Za-z0-9]+/)) if (part !== "") out += part[0]!.toUpperCase() + part.slice(1);
  return out === "" || /^[0-9]/.test(out) ? `Fish${out}` : out;
}

// A name as JNI spells it in a symbol.
export function jniName(name: string): string {
  let out = "";
  for (const c of name) {
    if (/^[A-Za-z0-9]$/.test(c)) out += c;
    else if (c === "_") out += "_1";
    else for (let i = 0; i < c.length; i++) {
      const code = c.charCodeAt(i) as i64;
      out += "_0";
      for (let shift: i64 = 12; shift >= 0; shift -= 4) out += "0123456789abcdef".charAt((code >> shift) & 15);
    }
  }
  return out;
}

// The generated entry: the C ABI over the file's functions.
const ENTRY = `declare function fishmobile_give(text: Ptr<u8>, size: i64): void;
declare function fishmobile_copy(from: Ptr<u8>, to: MutPtr<u8>, size: i64): void;

function fishmobile_text(at: Ptr<u8>, size: i64): string {
  let bytes: u8[] = new Array(size + 1).fill(0 as u8);
  unsafe { fishmobile_copy(at, mutPtrOf(bytes[0]), size) };
  bytes.pop();
  return new TextDecoder().decode(bytes);
}

function fishmobile_return(s: Ref<string>): void {
  const bytes = new TextEncoder().encode(s);
  unsafe { fishmobile_give(bytes.length === 0 ? nullPtr<u8>() : ptrOf(bytes[0]), bytes.length as i64) };
}
`;

function entryOf(e: Ref<Export>): string {
  let params: string[] = [];
  let args: string[] = [];
  for (let i = 0; i < e.params.length; i++) {
    const t = e.params[i]!.type;
    if (t === "string") {
      params.push(`p${i}: Ptr<u8>, p${i}_size: i64`);
      args.push(`fishmobile_text(p${i}, p${i}_size)`);
    } else if (t === "boolean") {
      params.push(`p${i}: i32`);
      args.push(`p${i} !== 0`);
    } else {
      params.push(`p${i}: ${t}`);
      args.push(`p${i}`);
    }
  }
  const call = `${e.name}(${args.join(", ")})`;
  const returns = e.returns === "string" ? "void" : e.returns === "boolean" ? "i32" : e.returns;
  const body = e.returns === "void" ? `  ${call};` : e.returns === "string" ? `  const r = ${call};\n  fishmobile_return(r);` : e.returns === "boolean" ? `  return ${call} ? 1 : 0;` : `  return ${call};`;
  return `export function fishmobile_${e.name}(${params.join(", ")}): ${returns} {\n${body}\n}\n`;
}

// The C prototype of an export's ABI function.
function prototype(e: Ref<Export>): string {
  let params: string[] = [];
  for (let i = 0; i < e.params.length; i++) {
    const t = e.params[i]!.type;
    if (t === "string") params.push(`const uint8_t *p${i}, int64_t p${i}_size`);
    else params.push(`${row(t)[1]} p${i}`);
  }
  return `${e.returns === "string" ? "void" : row(e.returns)[1]} fishmobile_${e.name}(${params.length > 0 ? params.join(", ") : "void"});`;
}

function headerOf(name: string, exports: Ref<Export[]>): string {
  const guard = `${typeName(name).toUpperCase()}_FISHMOBILE_H`;
  return [`#ifndef ${guard}`, `#define ${guard}`, "", "#include <stdint.h>", "", "#ifdef __cplusplus", 'extern "C" {', "#endif", "", ...exports.map((e) => prototype(e)), "", "// The bytes of the last string a call on this thread returned, valid until its next such call.", "const uint8_t *fishmobile_result(int64_t *size);", "", "#ifdef __cplusplus", "}", "#endif", "", "#endif", ""].join("\n");
}

const GLUE = String.raw`#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static _Thread_local uint8_t *fishmobile_text_at;
static _Thread_local int64_t fishmobile_text_size;

void fishmobile_copy(const uint8_t *from, uint8_t *to, int64_t size) {
  if (size > 0) memcpy(to, from, (size_t)size);
}

void fishmobile_give(const uint8_t *text, int64_t size) {
  free(fishmobile_text_at);
  fishmobile_text_at = malloc((size_t)size + 1);
  if (size > 0) memcpy(fishmobile_text_at, text, (size_t)size);
  fishmobile_text_at[size] = 0;
  fishmobile_text_size = size;
}

const uint8_t *fishmobile_result(int64_t *size) {
  *size = fishmobile_text_size;
  return fishmobile_text_at;
}
`;

function swiftName(name: string): string {
  return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

function swiftOf(name: string, exports: Ref<Export[]>): string {
  const type = typeName(name);
  let funcs: string[] = [];
  for (const e of exports) {
    const params = e.params.map((p) => `${swiftName(p.name)}: ${row(p.type)[2]}`).join(", ");
    let args: string[] = [];
    let strings: Param[] = [];
    for (const p of e.params) {
      const n = swiftName(p.name);
      if (p.type === "string") {
        strings.push(p.clone());
        args.push(`${p.name}_buffer.baseAddress, Int64(${p.name}_buffer.count)`);
      } else if (p.type === "boolean") args.push(`${n} ? 1 : 0`);
      else if (p.type === "isize") args.push(`Int64(${n})`);
      else if (p.type === "usize") args.push(`UInt64(${n})`);
      else args.push(n);
    }
    const call = `fishmobile_${e.name}(${args.join(", ")})`;
    let body: string[] = [];
    if (e.returns === "void") body.push(call);
    else if (e.returns === "string") {
      body.push(call);
      body.push("return fishmobile_text()");
    } else if (e.returns === "boolean") body.push(`return ${call} != 0`);
    else if (e.returns === "isize") body.push(`return Int(${call})`);
    else if (e.returns === "usize") body.push(`return UInt(${call})`);
    else body.push(`return ${call}`);
    // Each string's bytes stay alive for the call inside the closures that lend them.
    strings.reverse();
    for (const p of strings) {
      const s = p.name;
      const inner = body.map((l) => `  ${l}`);
      body = [`${e.returns === "void" ? "" : "return "}Array(${swiftName(s)}.utf8).withUnsafeBufferPointer { ${s}_buffer in`, ...inner, "}"];
    }
    const result = e.returns === "void" ? "" : ` -> ${row(e.returns)[2]}`;
    funcs.push(`  public static func ${swiftName(e.name)}(${params})${result} {\n${body.map((l) => `    ${l}`).join("\n")}\n  }`);
  }
  const text = exports.some((e) => e.returns === "string") ? `\n\nprivate func fishmobile_text() -> String {\n  var size: Int64 = 0\n  let at = fishmobile_result(&size)\n  return String(decoding: UnsafeBufferPointer(start: at, count: Int(size)), as: UTF8.self)\n}` : "";
  return `// Calls ${name}'s Fish exports, built into ${type}.xcframework.\nimport ${type}Native\n\npublic enum ${type} {\n${funcs.join("\n\n")}\n}${text}\n`;
}

function kotlinName(name: string): string {
  return KOTLIN_KEYWORDS.has(name) || name.includes("$") ? `\`${name}\`` : name;
}

// The external function's name for an export.
function nativeName(e: Ref<Export>): string {
  return `native${e.name[0]!.toUpperCase()}${e.name.slice(1)}`;
}

function kotlinPackage(name: string): string {
  return `fish.${typeName(name).toLowerCase()}`;
}

function kotlinOf(name: string, exports: Ref<Export[]>): string {
  const type = typeName(name);
  let wrappers: string[] = [];
  let externals: string[] = [];
  for (const e of exports) {
    let args: string[] = [];
    for (const p of e.params) {
      const n = kotlinName(p.name);
      const r = row(p.type);
      if (p.type === "string") args.push(`${n}.toByteArray(Charsets.UTF_8)`);
      else if (r[3] !== r[4]) args.push(`${n}.to${r[4]}()`);
      else args.push(n);
    }
    const call = `${kotlinName(nativeName(e))}(${args.join(", ")})`;
    const r = row(e.returns);
    const value = e.returns === "string" ? `String(${call}, Charsets.UTF_8)` : r[3] !== r[4] ? `${call}.to${r[3]}()` : call;
    const params = e.params.map((p) => `${kotlinName(p.name)}: ${row(p.type)[3]}`).join(", ");
    wrappers.push(`    fun ${kotlinName(e.name)}(${params}): ${r[3]} = ${value}`);
    const raw = e.params.map((p, i) => `p${i}: ${row(p.type)[4]}`).join(", ");
    externals.push(`    @JvmStatic private external fun ${kotlinName(nativeName(e))}(${raw}): ${r[4]}`);
  }
  return `// Calls ${name}'s Fish exports in lib${name}.so.\npackage ${kotlinPackage(name)}\n\nobject ${type} {\n    init {\n        System.loadLibrary("${name}")\n    }\n\n${wrappers.join("\n")}\n\n${externals.join("\n")}\n}\n`;
}

function jniOf(name: string, exports: Ref<Export[]>, header: string): string {
  const prefix = `Java_${kotlinPackage(name).replaceAll(".", "_")}_${typeName(name)}_`;
  let funcs: string[] = [];
  for (const e of exports) {
    let params: string[] = [];
    let before: string[] = [];
    let after: string[] = [];
    let args: string[] = [];
    for (let i = 0; i < e.params.length; i++) {
      const t = e.params[i]!.type;
      params.push(`${row(t)[5]} p${i}`);
      if (t === "string") {
        before.push(`  jsize p${i}_size = (*env)->GetArrayLength(env, p${i});`);
        before.push(`  jbyte *p${i}_at = (*env)->GetByteArrayElements(env, p${i}, NULL);`);
        after.push(`  (*env)->ReleaseByteArrayElements(env, p${i}, p${i}_at, JNI_ABORT);`);
        args.push(`(const uint8_t *)p${i}_at, (int64_t)p${i}_size`);
      } else if (t === "boolean") args.push(`p${i} ? 1 : 0`);
      else args.push(`(${row(t)[1]})p${i}`);
    }
    const call = `fishmobile_${e.name}(${args.join(", ")})`;
    let body = [...before];
    if (e.returns === "void" || e.returns === "string") body.push(`  ${call};`);
    else body.push(`  ${row(e.returns)[1]} r = ${call};`);
    for (const l of after) body.push(l);
    if (e.returns === "string") body.push("  return fishmobile_bytes(env);");
    else if (e.returns === "boolean") body.push("  return r != 0 ? JNI_TRUE : JNI_FALSE;");
    else if (e.returns !== "void") body.push(`  return (${row(e.returns)[5]})r;`);
    funcs.push(`JNIEXPORT ${row(e.returns)[5]} JNICALL ${prefix}${jniName(nativeName(e))}(JNIEnv *env, jclass cls${params.map((p) => `, ${p}`).join("")}) {\n${body.join("\n")}\n}\n`);
  }
  const bytes = "static jbyteArray fishmobile_bytes(JNIEnv *env) {\n  int64_t size = 0;\n  const uint8_t *at = fishmobile_result(&size);\n  jbyteArray out = (*env)->NewByteArray(env, (jsize)size);\n  if (out != NULL && size > 0) (*env)->SetByteArrayRegion(env, out, 0, (jsize)size, (const jbyte *)at);\n  return out;\n}\n";
  return `${GLUE}\n#include <jni.h>\n\n${header}\n${bytes}\n${funcs.join("\n")}`;
}

// The C++ Turbo Module. It fills methodMap_ itself, as React Native's codegen would, so the app
// registers it from its C++ module provider with no codegen step.
function moduleOf(name: string, exports: Ref<Export[]>): string {
  const type = typeName(name);
  let entries: string[] = [];
  let methods: string[] = [];
  for (const e of exports) {
    entries.push(`    methodMap_["${e.name}"] = MethodMetadata{${e.params.length}, call_${e.name}};`);
    let lines: string[] = [];
    let args: string[] = [];
    for (let i = 0; i < e.params.length; i++) {
      const t = e.params[i]!.type;
      const range = RANGES.find((r) => r[0] === t);
      if (t === "string") {
        lines.push(`    std::string a${i} = fishText(rt, args, count, ${i});`);
        args.push(`(const uint8_t *)a${i}.data(), (int64_t)a${i}.size()`);
      } else if (t === "boolean") {
        lines.push(`    bool a${i} = fishBoolean(rt, args, count, ${i});`);
        args.push(`a${i} ? 1 : 0`);
      } else if (range !== undefined) {
        lines.push(`    double a${i} = fishInteger(rt, args, count, ${i}, ${range[1]}.0, ${range[2]}.0, "${range[1]} to ${range[2]}");`);
        args.push(`(${row(t)[1]})a${i}`);
      } else {
        lines.push(`    double a${i} = fishNumber(rt, args, count, ${i});`);
        args.push(`(${row(t)[1]})a${i}`);
      }
    }
    const call = `fishmobile_${e.name}(${args.join(", ")})`;
    if (e.returns === "void" || e.returns === "string") lines.push(`    ${call};`);
    if (e.returns === "void") lines.push("    return facebook::jsi::Value::undefined();");
    else if (e.returns === "string") lines.push("    return fishResult(rt);");
    else if (e.returns === "boolean") lines.push(`    return facebook::jsi::Value(${call} != 0);`);
    else lines.push(`    return facebook::jsi::Value((double)${call});`);
    methods.push(`  static facebook::jsi::Value call_${e.name}(facebook::jsi::Runtime &rt, facebook::react::TurboModule &, const facebook::jsi::Value *args, size_t count) {\n${lines.join("\n")}\n  }`);
  }
  const helpers = String.raw`  static const facebook::jsi::Value &fishArg(facebook::jsi::Runtime &rt, const facebook::jsi::Value *args, size_t count, size_t i) {
    if (i >= count) throw facebook::jsi::JSError(rt, "argument " + std::to_string(i + 1) + " is missing");
    return args[i];
  }

  static double fishNumber(facebook::jsi::Runtime &rt, const facebook::jsi::Value *args, size_t count, size_t i) {
    const facebook::jsi::Value &v = fishArg(rt, args, count, i);
    if (!v.isNumber()) throw facebook::jsi::JSError(rt, "argument " + std::to_string(i + 1) + " must be a number");
    return v.getNumber();
  }

  static double fishInteger(facebook::jsi::Runtime &rt, const facebook::jsi::Value *args, size_t count, size_t i, double low, double high, const char *range) {
    double n = fishNumber(rt, args, count, i);
    if (!(std::floor(n) == n && n >= low && n <= high)) throw facebook::jsi::JSError(rt, "argument " + std::to_string(i + 1) + " must be an integer from " + range);
    return n;
  }

  static bool fishBoolean(facebook::jsi::Runtime &rt, const facebook::jsi::Value *args, size_t count, size_t i) {
    const facebook::jsi::Value &v = fishArg(rt, args, count, i);
    if (!v.isBool()) throw facebook::jsi::JSError(rt, "argument " + std::to_string(i + 1) + " must be a boolean");
    return v.getBool();
  }

  static std::string fishText(facebook::jsi::Runtime &rt, const facebook::jsi::Value *args, size_t count, size_t i) {
    const facebook::jsi::Value &v = fishArg(rt, args, count, i);
    if (!v.isString()) throw facebook::jsi::JSError(rt, "argument " + std::to_string(i + 1) + " must be a string");
    return v.getString(rt).utf8(rt);
  }

  static facebook::jsi::Value fishResult(facebook::jsi::Runtime &rt) {
    int64_t size = 0;
    const uint8_t *at = fishmobile_result(&size);
    return facebook::jsi::String::createFromUtf8(rt, at, (size_t)size);
  }`;
  return `// A React Native Turbo Module calling ${name}'s Fish exports, linked against ${type}.xcframework
// or lib${name}.so. Register it from the app's C++ module provider under "Native${type}".
#pragma once

#include <ReactCommon/TurboModule.h>
#include <cmath>
#include <memory>
#include <string>

#include "${type}.h"

namespace fish {

class Native${type}Module : public facebook::react::TurboModule {
 public:
  static constexpr const char *kModuleName = "Native${type}";

  explicit Native${type}Module(std::shared_ptr<facebook::react::CallInvoker> jsInvoker) : facebook::react::TurboModule(kModuleName, std::move(jsInvoker)) {
${entries.join("\n")}
  }

 private:
${helpers}

${methods.join("\n\n")}
};

} // namespace fish
`;
}

function tsType(t: string): string {
  return t === "string" || t === "boolean" || t === "void" ? t : "number";
}

function specOf(name: string, exports: Ref<Export[]>): string {
  const methods = exports.map((e) => `  ${e.name}(${e.params.map((p) => `${p.name}: ${tsType(p.type)}`).join(", ")}): ${tsType(e.returns)};`).join("\n");
  return `import type { TurboModule } from "react-native";\nimport { TurboModuleRegistry } from "react-native";\n\nexport interface Spec extends TurboModule {\n${methods}\n}\n\nexport default TurboModuleRegistry.getEnforcing<Spec>("Native${typeName(name)}");\n`;
}

// The module for the file `src`, named `name`, whose generated entry imports it as `specifier`.
/** @throws {CompileError} */
export function mobileOf(src: string, specifier: string, name: string): Mobile {
  let ids: Ids = { last: 0 };
  const program = parse(src, ids);
  const exports = exportsOf(program);
  const fish = `import { ${exports.map((e) => e.name).join(", ")} } from ${JSON.stringify(specifier)};\n\n${ENTRY}\n${exports.map((e) => entryOf(e)).join("\n")}`;
  const header = headerOf(name, exports);
  const type = typeName(name);
  return {
    name,
    fish,
    glue: GLUE,
    header,
    modulemap: `module ${type}Native {\n  header "${type}.h"\n  export *\n}\n`,
    swift: swiftOf(name, exports),
    jni: jniOf(name, exports, header),
    kotlin: kotlinOf(name, exports),
    module: moduleOf(name, exports),
    spec: specOf(name, exports),
  };
}
