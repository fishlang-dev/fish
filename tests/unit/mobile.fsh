// `fishc build --mobile`: the wrappers generated for a file's exports, in process, and each
// platform's module run where it runs. Those runs need the platform's tools and are skipped
// without them: FISH_TEST_IOS_SIM names a simulator by UDID, FISH_TEST_ANDROID_EMU an Android
// virtual device (started here when no device is attached), and FISH_TEST_RN a react-native
// package directory, whose headers the Turbo Module is compiled against.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jniName, mobileOf, typeName, type Mobile } from "../../src/mobile.fsh";
import { fishc, removed, same, scratch } from "./support.fsh";

const SAMPLE = `export function add(a: i64, b: i64): i64 {
  return a + b;
}
export function greet(name: string, loud: boolean): string {
  return loud ? \`HELLO \${name}!\` : \`hello \${name}\`;
}
export function half(x: f64): f64 {
  return x / 2;
}
export function small(n: u8): u8 {
  return n + 1;
}
export function isEven(n: i32): boolean {
  return n % 2 === 0;
}
export function touch(): void {}
function hidden(): void {}
`;

// What every platform's run prints, one line per call.
const PRINTED = "42\nHELLO fish \u{1F41F}!\n2.5\n255\nfalse\n";

function sampleModule(): Mobile {
  try {
    return mobileOf(SAMPLE, "./sample.fsh", "sample");
  } catch (e) {
    assert(false, `the sample: ${e.message}`);
    return { name: "", fish: "", glue: "", header: "", modulemap: "", swift: "", jni: "", kotlin: "", module: "", spec: "" };
  }
}

function has(text: string, part: string, what: string): void {
  assert(text.includes(part), `${what} lacks:\n${part}\n--- in\n${text}`);
}

test("names become types and JNI symbols", () => {
  same(typeName("sample"), "Sample", "a plain name");
  same(typeName("my_lib-2"), "MyLib2", "a name with separators");
  same(typeName("3d"), "Fish3d", "a name starting with a digit");
  same(jniName("native_add$"), "native_1add_00024", "JNI's escapes");
});

test("the C ABI and the entry take strings as bytes and booleans as i32", () => {
  const made = sampleModule();
  has(made.header, "int64_t fishmobile_add(int64_t p0, int64_t p1);", "the header");
  has(made.header, "void fishmobile_greet(const uint8_t *p0, int64_t p0_size, int32_t p1);", "the header");
  has(made.header, "void fishmobile_touch(void);", "the header");
  has(made.header, "const uint8_t *fishmobile_result(int64_t *size);", "the header");
  assert(made.fish.startsWith(`import { add, greet, half, small, isEven, touch } from "./sample.fsh";`), "the entry imports every export and nothing else");
  has(made.fish, "export function fishmobile_greet(p0: Ptr<u8>, p0_size: i64, p1: i32): void {\n  const r = greet(fishmobile_text(p0, p0_size), p1 !== 0);\n  fishmobile_return(r);\n}", "the entry");
  has(made.fish, "export function fishmobile_isEven(p0: i32): i32 {\n  return isEven(p0) ? 1 : 0;\n}", "the entry");
  has(made.modulemap, "module SampleNative {", "the module map");
});

test("Swift calls the ABI with its own types", () => {
  const made = sampleModule();
  has(made.swift, "import SampleNative\n\npublic enum Sample {", "the Swift wrapper");
  has(made.swift, "  public static func add(a: Int64, b: Int64) -> Int64 {\n    return fishmobile_add(a, b)\n  }", "add");
  has(made.swift, "  public static func greet(name: String, loud: Bool) -> String {\n    return Array(name.utf8).withUnsafeBufferPointer { name_buffer in\n      fishmobile_greet(name_buffer.baseAddress, Int64(name_buffer.count), loud ? 1 : 0)\n      return fishmobile_text()\n    }\n  }", "greet");
  has(made.swift, "  public static func isEven(n: Int32) -> Bool {\n    return fishmobile_isEven(n) != 0\n  }", "isEven");
  has(made.swift, "  public static func touch() {\n    fishmobile_touch()\n  }", "touch");
});

test("Kotlin calls JNI, with strings as UTF-8 and unsigned types by width", () => {
  const made = sampleModule();
  has(made.kotlin, "package fish.sample\n\nobject Sample {\n    init {\n        System.loadLibrary(\"sample\")\n    }", "the Kotlin wrapper");
  has(made.kotlin, "    fun greet(name: String, loud: Boolean): String = String(nativeGreet(name.toByteArray(Charsets.UTF_8), loud), Charsets.UTF_8)", "greet");
  has(made.kotlin, "    fun small(n: UByte): UByte = nativeSmall(n.toByte()).toUByte()", "small");
  has(made.kotlin, "    @JvmStatic private external fun nativeGreet(p0: ByteArray, p1: Boolean): ByteArray", "greet's external");
  has(made.jni, "JNIEXPORT jbyteArray JNICALL Java_fish_sample_Sample_nativeGreet(JNIEnv *env, jclass cls, jbyteArray p0, jboolean p1) {", "the JNI glue");
  has(made.jni, "JNIEXPORT jbyte JNICALL Java_fish_sample_Sample_nativeSmall(JNIEnv *env, jclass cls, jbyte p0) {\n  uint8_t r = fishmobile_small((uint8_t)p0);\n  return (jbyte)r;\n}", "small's glue");
  has(made.jni, "void fishmobile_give(const uint8_t *text, int64_t size) {", "the glue's buffer");
});

test("React Native gets a Turbo Module and its spec", () => {
  const made = sampleModule();
  has(made.spec, "export interface Spec extends TurboModule {\n  add(a: number, b: number): number;\n  greet(name: string, loud: boolean): string;", "the spec");
  has(made.spec, `TurboModuleRegistry.getEnforcing<Spec>("NativeSample");`, "the spec");
  has(made.module, `    methodMap_["greet"] = MethodMetadata{2, call_greet};`, "the module");
  has(made.module, `    double a0 = fishInteger(rt, args, count, 0, -9007199254740991.0, 9007199254740991.0, "-9007199254740991 to 9007199254740991");`, "add's integer check");
  has(made.module, "    std::string a0 = fishText(rt, args, count, 0);", "greet's string");
});

function refusal(src: string): string {
  try {
    mobileOf(src, "./x.fsh", "x");
  } catch (e) {
    return e.message;
  }
  return "";
}

test("what can't cross is refused, naming why", () => {
  same(refusal(`export function f(x: string[]): void {}`), "a mobile module can't pass this type; a mobile module passes integers, f32, f64, boolean and string", "an array");
  same(refusal(`export function f(x: Point): void {}`), "a mobile module can't pass 'Point'; a mobile module passes integers, f32, f64, boolean and string", "an object type");
  same(refusal(`export function f<T>(x: T): void {}`), "a mobile module can't export a generic function; export one for each type", "a generic");
  same(refusal(`export async function f(): Promise<void> {}`), "a mobile module's exports are called synchronously; export a function that isn't async or a generator", "async");
  same(refusal(`export function f(): void throws Error {\n  throw new Error("no");\n}`), "'f' throws, which Swift and Kotlin can't catch from Fish; catch the error in Fish and return a value saying what failed", "throws");
  same(refusal(`export function f(x: i64) {}`), "'f' needs its return type written to be exported, 'void' if it returns nothing", "no return type");
  same(refusal(`function f(): void {}`), "a mobile module has nothing to call; mark functions with 'export'", "no exports");
});

test("fishc build --mobile react-native writes the module, and refusals name their place", () => {
  const root = scratch("fish-mobile-");
  try {
    writeFileSync(join(root, "sample.fsh"), SAMPLE);
    const built = fishc(root, ["build", "--mobile", "react-native", "sample.fsh"]);
    same(`${built.code} ${built.err}`, "0 ", "the build");
    const made = sampleModule();
    same(readFileSync(join(root, "sample-react-native", "NativeSample.ts"), "utf8"), made.spec, "the spec");
    same(readFileSync(join(root, "sample-react-native", "NativeSampleModule.h"), "utf8"), made.module, "the module");
    same(readFileSync(join(root, "sample-react-native", "Sample.h"), "utf8"), made.header, "the header");
    writeFileSync(join(root, "bad.fsh"), "export function f(x: [i64, i64]): void {}\n");
    const refused = fishc(root, ["build", "--mobile", "ios", "bad.fsh"]);
    assert(refused.code === 1 && refused.err.includes("bad.fsh:1:22: error[E1003]: a mobile module can't pass this type"), `the refusal: ${refused.err}`);
    const unknown = fishc(root, ["build", "--mobile", "watchos", "sample.fsh"]);
    assert(unknown.code !== 0 && unknown.err.includes("--mobile ios|android|react-native"), `an unknown platform: ${unknown.err}`);
  } catch (e) {
    assert(false, `the module's files: ${e.message}`);
  }
  removed(root);
}, { timeout: 120_000 });

// Runs a command, failing the test with its output when it fails, and gives its stdout.
function ran(args: string[], what: string): string {
  const run = spawnSync(args[0]!, args.slice(1));
  const failed = run.error;
  if (failed !== null) assert(false, `${what}: can't run ${args[0]!}: ${failed.message}`);
  const decoder = new TextDecoder();
  assert(run.status === 0, `${what} exited ${run.status ?? -1}:\n${decoder.decode(run.stdout)}${decoder.decode(run.stderr)}`);
  return decoder.decode(run.stdout);
}

test("the Swift wrapper runs in the iOS Simulator", () => {
  const sim = process.env.FISH_TEST_IOS_SIM ?? "";
  if (sim === "" || process.platform !== "darwin") {
    console.log("skipped: running the Swift wrapper needs FISH_TEST_IOS_SIM, a simulator's UDID from 'xcrun simctl list devices'");
    return;
  }
  const root = scratch("fish-mobile-ios-");
  try {
    writeFileSync(join(root, "sample.fsh"), SAMPLE);
    const built = fishc(root, ["build", "--mobile", "ios", "sample.fsh"]);
    same(`${built.code} ${built.err}`, "0 ", "the build");
    const framework = join(root, "sample-ios", "Sample.xcframework");
    assert(existsSync(join(framework, "Info.plist")), "no Info.plist in the xcframework");
    const slice = readdirSync(framework).find((d) => d.endsWith("-simulator"));
    assert(slice !== undefined, "no simulator slice in the xcframework");
    const at = join(framework, slice!);
    writeFileSync(join(root, "main.swift"), `print(Sample.add(a: 2, b: 40))\nprint(Sample.greet(name: "fish \u{1F41F}", loud: true))\nprint(Sample.half(x: 5))\nprint(Sample.small(n: 254))\nprint(Sample.isEven(n: 7))\nSample.touch()\n`);
    const cpu = process.arch === "arm64" ? "arm64" : "x86_64";
    ran(["xcrun", "--sdk", "iphonesimulator", "swiftc", "-target", `${cpu}-apple-ios15.0-simulator`, "-I", join(at, "Headers"), "-L", at, "-lsample", "-lc++", join(root, "sample-ios", "Sample.swift"), join(root, "main.swift"), "-o", join(root, "main")], "swiftc");
    spawnSync("xcrun", ["simctl", "boot", sim]);
    ran(["xcrun", "simctl", "bootstatus", sim, "-b"], "waiting for the simulator");
    same(ran(["xcrun", "simctl", "spawn", sim, join(root, "main")], "the program in the simulator"), PRINTED, "what it printed");
  } catch (e) {
    assert(false, `the iOS run: ${e.message}`);
  }
  removed(root);
}, { timeout: 1_800_000 });

// The Android SDK, as the build looks for it.
function androidSdk(): string {
  const home = process.env.HOME ?? "";
  return process.env.ANDROID_HOME ?? (process.platform === "darwin" ? join(home, "Library", "Android", "sdk") : join(home, "Android", "Sdk"));
}

test("the Kotlin wrapper runs in an Android emulator", () => {
  const avd = process.env.FISH_TEST_ANDROID_EMU ?? "";
  if (avd === "") {
    console.log("skipped: running the Kotlin wrapper needs FISH_TEST_ANDROID_EMU, an AVD name from 'emulator -list-avds', with kotlinc on PATH");
    return;
  }
  const sdk = androidSdk();
  const adb = join(sdk, "platform-tools", "adb");
  const root = scratch("fish-mobile-android-");
  let started = false;
  try {
    writeFileSync(join(root, "sample.fsh"), SAMPLE);
    const built = fishc(root, ["build", "--mobile", "android", "sample.fsh"]);
    same(`${built.code} ${built.err}`, "0 ", "the build");
    writeFileSync(join(root, "Main.kt"), `import fish.sample.Sample\n\nfun main() {\n    println(Sample.add(2, 40))\n    println(Sample.greet("fish \u{1F41F}", true))\n    println(Sample.half(5.0))\n    println(Sample.small(254.toUByte()))\n    println(Sample.isEven(7))\n    Sample.touch()\n}\n`);
    ran(["kotlinc", join(root, "sample-android", "Sample.kt"), join(root, "Main.kt"), "-include-runtime", "-d", join(root, "app.jar")], "kotlinc");
    let tools = readdirSync(join(sdk, "build-tools"));
    tools.sort();
    mkdirSync(join(root, "dex"));
    ran([join(sdk, "build-tools", tools[tools.length - 1]!, "d8"), "--min-api", "28", "--output", join(root, "dex"), join(root, "app.jar")], "d8");
    if (!ran([adb, "devices"], "adb devices").split("\n").some((l) => l.endsWith("\tdevice"))) {
      ran(["sh", "-c", `"${join(sdk, "emulator", "emulator")}" -avd "${avd}" -no-window -no-audio -no-snapshot-save >/dev/null 2>&1 &`], "starting the emulator");
      started = true;
    }
    ran([adb, "wait-for-device", "shell", "while [ \"$(getprop sys.boot_completed)\" != 1 ]; do sleep 1; done"], "waiting for the device");
    const abi = ran([adb, "shell", "getprop", "ro.product.cpu.abi"], "the device's ABI").trim();
    const there = "/data/local/tmp/fishmobile";
    ran([adb, "shell", "mkdir", "-p", there], "making the device's directory");
    ran([adb, "push", join(root, "dex", "classes.dex"), join(root, "sample-android", "jniLibs", abi, "libsample.so"), there], "pushing the program");
    same(ran([adb, "shell", `cd ${there} && CLASSPATH=${there}/classes.dex LD_LIBRARY_PATH=${there} app_process -Djava.library.path=${there} ${there} MainKt`], "the program on the device"), PRINTED, "what it printed");
  } catch (e) {
    assert(false, `the Android run: ${e.message}`);
  }
  if (started) spawnSync(adb, ["emu", "kill"]);
  removed(root);
}, { timeout: 1_800_000 });

test("the Turbo Module compiles against React Native's headers", () => {
  const rn = process.env.FISH_TEST_RN ?? "";
  if (rn === "") {
    console.log("skipped: compiling the Turbo Module needs FISH_TEST_RN, a react-native package directory");
    return;
  }
  const root = scratch("fish-mobile-rn-");
  try {
    writeFileSync(join(root, "sample.fsh"), SAMPLE);
    const built = fishc(root, ["build", "--mobile", "react-native", "sample.fsh"]);
    same(`${built.code} ${built.err}`, "0 ", "the build");
    const out = join(root, "sample-react-native");
    writeFileSync(join(out, "check.cpp"), `#include "NativeSampleModule.h"\n\nstd::shared_ptr<facebook::react::TurboModule> made(std::shared_ptr<facebook::react::CallInvoker> invoker) {\n  return std::make_shared<fish::NativeSampleModule>(invoker);\n}\n`);
    const common = join(rn, "ReactCommon");
    ran(["clang++", "-std=c++20", "-fsyntax-only", "-Wall", "-I", common, "-I", join(common, "jsi"), "-I", join(common, "callinvoker"), "-I", join(common, "react", "nativemodule", "core"), "-I", out, join(out, "check.cpp")], "clang++");
  } catch (e) {
    assert(false, `the Turbo Module: ${e.message}`);
  }
  removed(root);
}, { timeout: 300_000 });
