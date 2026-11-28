// `fishc allocs`: which runtime functions may allocate, read from C, and the sites the IR calls them at.
import { allocators, allocs, formatAllocs } from "../../src/allocs.fsh";
import { NATIVE } from "../../src/native.fsh";

function same(got: string, want: string): void {
  assert(got === want, `got ${got}, want ${want}`);
}

function c(): string {
  return [
    "void grow_fail(void *p) {",
    "  grow(p);",
    "}",
    "",
    "static void *grow(void *p) {",
    "  return realloc(p, 64); // malloc( in a comment isn't a call",
    "}",
    "",
    "void *fsh_rt_box(int64_t n) {",
    "  return grow(NULL);",
    "}",
    "",
    "int64_t fsh_rt_len(void *p);",
    "__attribute__((constructor)) static void fsh_seed(void) {",
    '  puts("calloc(1)");',
    "}",
    "",
    "#define FSH_BOX(n) fsh_rt_box(n)",
    "static int64_t fsh_one(void) { return 1; }",
    "void fsh_rt_free(void *p) {",
    "  free(p);",
    "}",
    "",
  ].join("\n");
}

test("a function allocates when it reaches one of C's allocators", () => {
  const found = allocators(c());
  for (const f of ["grow", "fsh_rt_box", "FSH_BOX", "malloc"]) assert(found.has(f), `${f} should allocate`);
  for (const f of ["fsh_rt_free", "fsh_seed", "fsh_one", "fsh_rt_len"]) assert(!found.has(f), `${f} shouldn't allocate`);
});

test("the runtime's allocating entry points are found and its freeing ones are not", () => {
  const found = allocators(NATIVE);
  for (const f of ["fsh_rt_alloc", "fsh_rt_array_alloc", "fsh_rt_str_concat", "fsh_rt_map_insert"]) assert(found.has(f), `${f} should allocate`);
  for (const f of ["fsh_rt_free", "fsh_rt_str_retain"]) assert(!found.has(f), `${f} shouldn't allocate`);
});

function ir(): string {
  return [
    "declare ptr @fsh_rt_box(i64)",
    "declare void @grow_fail(ptr) noreturn cold",
    'define internal ptr @"fsh.id#rv34vv"(i64 %x.arg) {',
    "entry:",
    "  %t0 = call ptr @fsh_rt_box(i64 8)",
    "  %t1 = invoke ptr @fsh_rt_box(i64 8) to label %ok unwind label %bad",
    "  call void @fsh_rt_free(ptr %t0)",
    "  ret ptr %t1",
    "}",
    "",
    'define internal ptr @"fsh.id#0sdgx7"(ptr %x.arg) {',
    "entry:",
    "  %t0 = call ptr @grow(ptr null)",
    "  call void @grow_fail(ptr null)",
    "  ret ptr %t0",
    "}",
    "",
    'define internal void @"fsh.main"() {',
    "entry:",
    '  call void @"fsh.id#0sdgx7"(ptr null)',
    "  ret void",
    "}",
    "",
  ].join("\n");
}

test("each call of an allocating runtime function is a site in the function holding it, a panic's not", () => {
  const a = allocs(ir(), allocators(c()));
  same(`${a.functions}`, "3");
  same(a.sites.functions.map((f) => `${f.name} ${f.bytes}`).join("|"), ['"fsh.id#rv34vv" 2', '"fsh.id#0sdgx7" 1'].join("|"));
  same(a.allocators.map((x) => `${x.name} ${x.sites}`).join("|"), "fsh_rt_box 2|grow 1");
  same(a.sites.groups.map((g) => `${g.name} ${g.instances} ${g.bytes}`).join("|"), "fsh.id 2 3");
  const text = formatAllocs(a, 5);
  same(text.split("\n")[0]!, "3 heap allocation sites in 2 of 3 functions, through 2 runtime functions");
  assert(text.includes('"fsh.id#rv34vv"  (fsh_rt_box 2)'), text);
});
