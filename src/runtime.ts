import { layoutOf, type Slots } from "./layout.ts";
import type { Expr } from "./parser.ts";
import { INTEGERS, type Integer, type Type } from "./typing.ts";

// What compiled programs call into: libc's printf, and the C runtime. A panic is the runtime's
// `fsh_rt_panic`, which prints its message, then aborts or unwinds, as the build chose.
export const RUNTIME = [
  "declare i32 @printf(ptr, ...)",
  "declare i32 @dprintf(i32, ptr, ...)",
  "declare i32 @fflush(ptr)",
  "declare void @exit(i32) noreturn",
  "declare void @abort() noreturn",
  "declare ptr @fsh_rt_format_f64(double, ptr)",
  "declare ptr @fsh_rt_format_i128(i128, ptr)",
  "declare ptr @fsh_rt_format_u128(i128, ptr)",
  "declare ptr @fsh_rt_format_f32(float, ptr)",
  "declare void @fsh_rt_str_retain(ptr)",
  "declare void @fsh_rt_str_release(ptr)",
  "declare ptr @fsh_rt_str_concat(ptr, ptr)",
  "declare ptr @fsh_rt_str_join(ptr, i64)",
  "declare i32 @fsh_rt_str_compare(ptr, ptr)",
  "declare ptr @fsh_rt_str_next(ptr, ptr)",
  "declare void @fsh_rt_str_print(i32, ptr)",
  "declare i64 @fsh_rt_str_units(ptr)",
  "declare i16 @fsh_rt_str_unit(ptr, i64)",
  "declare ptr @fsh_rt_str_at(ptr, i64)",
  "declare i64 @fsh_rt_str_index_of(ptr, ptr, i64)",
  "declare i64 @fsh_rt_str_last_index_of(ptr, ptr, i64)",
  "declare ptr @fsh_rt_str_replace_all(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_fs_read_sync(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_fs_write_sync(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_fs_exists(ptr)",
  "declare i32 @fsh_rt_fs_stat(ptr, i32, ptr, ptr, ptr)",
  "declare i32 @fsh_rt_fs_readdir(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_fs_realpath(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_fs_mkdtemp(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_fs_rm(ptr, i32, i32, ptr)",
  "declare i32 @fsh_rt_spawn_sync(ptr, ptr, ptr, ptr, ptr, ptr, ptr, ptr)",
  "declare ptr @fsh_rt_str_from_units(ptr, i64)",
  "declare ptr @fsh_rt_str_from_points(ptr, i64, ptr)",
  "declare ptr @fsh_rt_str_at_or_null(ptr, i64)",
  "declare ptr @fsh_rt_str_char_at(ptr, i64)",
  "declare i64 @fsh_rt_str_code_point_at(ptr, i64)",
  "declare i32 @fsh_rt_str_starts_with(ptr, ptr, i64)",
  "declare i32 @fsh_rt_str_ends_with(ptr, ptr, i64)",
  "declare void @fsh_rt_str_split(ptr, ptr, ptr, i64)",
  "declare ptr @fsh_rt_str_trim(ptr, i32)",
  "declare ptr @fsh_rt_str_case(ptr, i32)",
  "declare ptr @fsh_rt_str_replace(ptr, ptr, ptr)",
  "declare ptr @fsh_rt_str_pad(ptr, i64, ptr, i32, ptr)",
  "declare ptr @fsh_rt_str_repeat(ptr, i64, ptr)",
  "declare ptr @fsh_rt_str_slice(ptr, i64, i64, i32)",
  "declare ptr @fsh_rt_str_substring(ptr, i64, i64, i32)",
  "declare void @fsh_rt_panic(ptr) noreturn cold",
  "declare ptr @fsh_rt_array_alloc(i64)",
  "declare ptr @fsh_rt_map_new(i64, i64, i64, i32, ptr, ptr)",
  "declare i64 @fsh_rt_map_find(ptr, i64)",
  "declare ptr @fsh_rt_map_insert(ptr, i64, ptr)",
  "declare ptr @fsh_rt_map_remove(ptr, i64)",
  "declare ptr @fsh_rt_map_at(ptr, i64)",
  "declare i64 @fsh_rt_map_used(ptr)",
  "declare i64 @fsh_rt_map_size(ptr)",
  "declare void @fsh_rt_map_clear(ptr)",
  "declare void @fsh_rt_map_free(ptr)",
  "declare ptr @fsh_rt_map_copy(ptr)",
  "declare void @fsh_rt_map_copied(ptr, i64, i64)",
  "declare void @fsh_rt_array_reserve(ptr, i64)",
  "declare void @fsh_rt_array_extend(ptr, ptr, i64)",
  "declare void @fsh_rt_array_grow(ptr, i64, i64, ptr)",
  "declare void @fsh_rt_array_shrink(ptr, i64)",
  "declare void @fsh_rt_array_open(ptr, i64, i64, i64)",
  "declare void @fsh_rt_array_take(ptr, i64, i64, i64, ptr)",
  "declare void @fsh_rt_array_reverse(ptr, i64)",
  "declare void @fsh_rt_sort(ptr, i64, i64, ptr, ptr, ptr)",
  "declare ptr @fsh_rt_alloc(i64)",
  "declare void @fsh_rt_print_begin(i32)",
  "declare void @fsh_rt_print_end(i32)",
  "declare void @fsh_rt_free(ptr)",
  "declare void @fsh_rt_panic_bounds(ptr, i64, i64) noreturn cold",
  "declare void @fsh_rt_panic_assert(ptr, ptr) noreturn cold",
  "declare void @fsh_rt_panic_rust(ptr, ptr) noreturn cold",
  "declare void @fsh_rt_rust_dropped(ptr, ptr)",
  "declare i32 @__gcc_personality_v0(...)",
  "declare ptr @fsh_rt_str_from_i64(i64)",
  "declare ptr @fsh_rt_str_cstring(ptr)",
  "declare void @fsh_rt_wake(ptr)",
  "declare i32 @fsh_rt_sleep(ptr, ptr)",
  "declare i32 @fsh_rt_join(ptr, ptr, ptr, ptr, ptr)",
  "declare void @fsh_rt_handle_drop(ptr)",
  "declare void @fsh_rt_handle_retain(ptr)",
  "declare i32 @fsh_rt_lock(ptr)",
  "declare void @fsh_rt_unlock(ptr)",
  "declare i32 @fsh_rt_read_lock(ptr)",
  "declare void @fsh_rt_read_unlock(ptr)",
  "declare i32 @fsh_rt_write_lock(ptr)",
  "declare ptr @fsh_rt_shared_new(i64)",
  "declare void @fsh_rt_shared_retain(ptr)",
  "declare i32 @fsh_rt_shared_release(ptr)",
  "declare ptr @fsh_rt_semaphore_new(i64)",
  "declare void @fsh_rt_block_retain(ptr)",
  "declare void @fsh_rt_semaphore_release(ptr)",
  "declare i64 @fsh_rt_semaphore_available(ptr)",
  "declare i32 @fsh_rt_semaphore_acquire(ptr, ptr, ptr, ptr)",
  "declare void @fsh_rt_permit_drop(ptr)",
  "declare ptr @fsh_rt_channel_new(i64, i64, ptr)",
  "declare void @fsh_rt_channel_release(ptr)",
  "declare i32 @fsh_rt_channel_send(ptr, ptr, ptr, ptr)",
  "declare i32 @fsh_rt_channel_receive(ptr, ptr, ptr, ptr)",
  "declare void @fsh_rt_channel_close(ptr)",
  "declare i32 @fsh_rt_channel_settle(ptr, ptr)",
  "declare i32 @fsh_rt_timeouts_claim()",
  "declare void @fsh_rt_timeouts_task(ptr)",
  "declare i64 @fsh_rt_timeout_set(ptr, ptr, i64, i32)",
  "declare void @fsh_rt_timeout_clear(i64)",
  "declare i32 @fsh_rt_timeout_next(ptr, ptr)",
  "declare ptr @fsh_rt_signal_new()",
  "declare void @fsh_rt_signal_release(ptr)",
  "declare i32 @fsh_rt_signal_aborted(ptr)",
  "declare void @fsh_rt_signal_abort(ptr)",
  "declare ptr @fsh_rt_signal_timeout(i64)",
  "declare ptr @fsh_rt_signal_any(ptr, i64)",
  "declare ptr @fsh_rt_signal_shutdown()",
  "declare void @fsh_rt_socket_release(ptr)",
  "declare void @fsh_rt_js_release(ptr)",
  "declare ptr @fsh_rt_js_evaluate(ptr, ptr)",
  "declare i32 @fsh_rt_js_typeof(ptr, ptr)",
  "declare ptr @fsh_rt_js_string(ptr)",
  "declare double @fsh_rt_js_number(ptr)",
  "declare i32 @fsh_rt_js_boolean(ptr)",
  "declare ptr @fsh_rt_js_get(ptr, ptr, ptr)",
  "declare ptr @fsh_rt_js_at(ptr, i64, ptr)",
  "declare i32 @fsh_rt_js_has(ptr, ptr, ptr)",
  "declare ptr @fsh_rt_js_export(ptr, i64, ptr, ptr)",
  "declare ptr @fsh_rt_js_call(ptr, ptr, i64, ptr, ptr)",
  "declare ptr @fsh_rt_js_of_string(ptr)",
  "declare ptr @fsh_rt_js_of_number(double)",
  "declare ptr @fsh_rt_js_of_boolean(i32)",
  "declare ptr @fsh_rt_js_of_empty(i32)",
  "declare i32 @fsh_rt_js_is(ptr, i32, ptr, double)",
  "declare i32 @fsh_rt_js_field_is(ptr, ptr, i32, ptr, double)",
  "declare ptr @fsh_rt_js_peek(ptr, ptr, i64)",
  "declare i64 @fsh_rt_js_count(ptr)",
  "declare i32 @fsh_rt_js_await(ptr, ptr, ptr, ptr)",
  "declare ptr @fsh_rt_js_message(ptr)",
  "declare ptr @fsh_rt_js_function(ptr, ptr, ptr, i32)",
  "declare ptr @fsh_rt_js_promise(ptr)",
  "declare void @fsh_rt_js_settle(ptr, ptr)",
  "declare double @fsh_rt_js_as_integer(ptr, double, double, ptr, ptr, ptr)",
  "declare void @fsh_rt_js_mismatch(ptr, ptr, ptr, ptr)",
  "declare ptr @fsh_rt_js_array()",
  "declare void @fsh_rt_js_set(ptr, ptr, ptr, ptr)",
  "declare ptr @fsh_rt_js_new(ptr, i64, ptr, ptr)",
  "declare ptr @fsh_rt_js_object()",
  "declare void @fsh_rt_js_push(ptr, ptr)",
  "declare void @fsh_rt_js_put(ptr, ptr, ptr)",
  "declare void @fsh_rt_js_object_is(ptr, ptr, ptr, ptr)",
  "declare i64 @fsh_rt_js_length(ptr, ptr, ptr, ptr)",
  "declare ptr @fsh_rt_js_as_string(ptr, ptr, ptr, ptr)",
  "declare double @fsh_rt_js_as_number(ptr, ptr, ptr, ptr)",
  "declare i32 @fsh_rt_js_as_boolean(ptr, ptr, ptr, ptr)",
  "declare i32 @fsh_rt_tcp_bind(ptr, i64, ptr, ptr)",
  "declare i64 @fsh_rt_tcp_port(ptr)",
  "declare i32 @fsh_rt_tcp_accept(ptr, ptr, ptr, ptr)",
  "declare i32 @fsh_rt_tcp_read(ptr, i64, ptr, ptr, ptr)",
  "declare void @fsh_rt_socket_leave(ptr, ptr)",
  "declare void @fsh_rt_utf8_encode(ptr, ptr)",
  "declare ptr @fsh_rt_utf8_decode(ptr)",
  "declare i32 @fsh_rt_parse_int(ptr, i64, ptr)",
  "declare i32 @fsh_rt_parse_float(ptr, ptr)",
  "declare i32 @fsh_rt_parse_number(ptr, ptr)",
  "declare ptr @fsh_rt_to_fixed(double, i64)",
  "declare i32 @fsh_rt_regex_test(ptr, ptr)",
  "declare i32 @fsh_rt_regex_match(ptr, ptr, ptr)",
  "declare i64 @fsh_rt_regex_search(ptr, ptr)",
  "declare i32 @fsh_rt_regex_match_all(ptr, ptr, ptr)",
  "declare void @fsh_rt_regex_split(ptr, ptr, ptr, i64, i32, i32, i32)",
  "declare ptr @fsh_rt_regex_iter(ptr, ptr, i32)",
  "declare i32 @fsh_rt_regex_next(ptr)",
  "declare ptr @fsh_rt_regex_slots(ptr)",
  "declare void @fsh_rt_regex_put(ptr, ptr)",
  "declare void @fsh_rt_regex_put_pattern(ptr, ptr)",
  "declare ptr @fsh_rt_regex_finish(ptr)",
  "declare void @fsh_rt_regex_close(ptr)",
  "declare ptr @fsh_rt_int_to_fixed(i64, i32, i64)",
  "declare ptr @fsh_rt_http_date()",
  "declare i64 @fsh_rt_now_ms()",
  "declare void @fsh_rt_constants(ptr)",
  "declare ptr @fsh_rt_dyn_alloc(i64)",
  "declare ptr @fsh_rt_dyn_retain(ptr)",
  "declare i1 @fsh_rt_dyn_release(ptr)",
  "declare void @fsh_rt_dyn_free(ptr)",
  "declare i32 @fsh_rt_tcp_write(ptr, ptr, ptr, ptr, ptr)",
  "declare i32 @fsh_rt_tcp_connect(ptr, ptr, i64, ptr, ptr, ptr)",
  "declare i32 @fsh_rt_signal_enter(ptr, ptr, ptr)",
  "declare void @fsh_rt_signal_leave(ptr, ptr, ptr)",
  "declare void @fsh_rt_semaphore_leave(ptr, ptr, ptr)",
  "declare void @fsh_rt_channel_leave(ptr, ptr, ptr)",
  "declare ptr @fsh_rt_spawn(ptr, ptr, ptr, ptr, i64, i64)",
  "declare ptr @fsh_rt_spawn_now(ptr, ptr, ptr, ptr, i64, i64)",
  "declare ptr @fsh_rt_spawn_blocking(ptr, ptr, ptr, ptr, i64, i64)",
  "declare i32 @fsh_rt_run(ptr, ptr, ptr, ptr, i64, i64, ptr)",
  "declare ptr @fsh_rt_str_from_cstring(ptr)",
  "declare ptr @fsh_rt_str_from_u64(i64)",
  "declare ptr @fsh_rt_str_from_i128(i128)",
  "declare void @fsh_rt_big_retain(ptr)",
  "declare void @fsh_rt_big_release(ptr)",
  "declare ptr @fsh_rt_big_from_u128(i128, i32)",
  "declare ptr @fsh_rt_big_from_i128(i128)",
  "declare i32 @fsh_rt_big_compare(ptr, ptr)",
  "declare i1 @fsh_rt_big_equal(ptr, ptr)",
  "declare ptr @fsh_rt_big_add(ptr, ptr)",
  "declare ptr @fsh_rt_big_sub(ptr, ptr)",
  "declare ptr @fsh_rt_big_mul(ptr, ptr)",
  "declare ptr @fsh_rt_big_div(ptr, ptr, i32, ptr)",
  "declare ptr @fsh_rt_big_neg(ptr)",
  "declare ptr @fsh_rt_big_pow(ptr, ptr, ptr)",
  "declare ptr @fsh_rt_big_shift(ptr, ptr, i32, ptr)",
  "declare ptr @fsh_rt_big_bitwise(ptr, ptr, i32)",
  "declare ptr @fsh_rt_big_not(ptr)",
  "declare ptr @fsh_rt_big_text(ptr, i64)",
  "declare ptr @fsh_rt_big_to_string(ptr, i64, ptr)",
  "declare i128 @fsh_rt_big_low(ptr)",
  "declare double @fsh_rt_big_f64(ptr)",
  "declare ptr @fsh_rt_str_from_u128(i128)",
  "declare ptr @fsh_rt_str_from_f64(double)",
  "declare ptr @fsh_rt_str_from_f32(float)",
  "declare ptr @fsh_rt_json_new()",
  "declare void @fsh_rt_json_raw(ptr, ptr, i64)",
  "declare void @fsh_rt_json_i64(ptr, i64)",
  "declare void @fsh_rt_json_i128(ptr, i128)",
  "declare void @fsh_rt_json_u128(ptr, i128)",
  "declare void @fsh_rt_json_u64(ptr, i64)",
  "declare void @fsh_rt_json_f64(ptr, double, i32)",
  "declare void @fsh_rt_json_string(ptr, ptr)",
  "declare ptr @fsh_rt_json_done(ptr)",
  "declare ptr @fsh_rt_json_in(ptr)",
  "declare ptr @fsh_rt_json_close(ptr)",
  "declare i64 @fsh_rt_json_field_path(ptr, ptr)",
  "declare i64 @fsh_rt_json_index_path(ptr, i64)",
  "declare void @fsh_rt_json_back(ptr, i64)",
  "declare void @fsh_rt_json_save(ptr, ptr)",
  "declare void @fsh_rt_json_restore(ptr, ptr)",
  "declare void @fsh_rt_json_forget(ptr)",
  "declare i32 @fsh_rt_json_expected(ptr, ptr)",
  "declare i32 @fsh_rt_json_missing(ptr, ptr)",
  "declare i32 @fsh_rt_json_unlike(ptr, ptr)",
  "declare void @fsh_rt_json_settle(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_json_peek(ptr)",
  "declare i32 @fsh_rt_json_null(ptr)",
  "declare i32 @fsh_rt_json_bool(ptr, ptr)",
  "declare i32 @fsh_rt_json_int(ptr, ptr, i32, i32, ptr)",
  "declare i32 @fsh_rt_json_float(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_json_text(ptr, ptr, ptr)",
  "declare i32 @fsh_rt_json_same(ptr, ptr, i64)",
  "declare i32 @fsh_rt_json_open(ptr, i32, ptr)",
  "declare i32 @fsh_rt_json_more(ptr, i32, i32)",
  "declare i32 @fsh_rt_json_key(ptr, ptr)",
  "declare i32 @fsh_rt_json_skip(ptr)",
  "declare i32 @fsh_rt_json_end(ptr)",
  "declare ptr @fsh_rt_insp_text(ptr)",
  "declare ptr @fsh_rt_insp_i64(i64)",
  "declare ptr @fsh_rt_insp_i128(i128)",
  "declare ptr @fsh_rt_insp_bigint(ptr)",
  "declare ptr @fsh_rt_insp_u128(i128)",
  "declare ptr @fsh_rt_insp_u64(i64)",
  "declare ptr @fsh_rt_insp_f64(double, i32)",
  "declare ptr @fsh_rt_insp_string(ptr)",
  "declare ptr @fsh_rt_insp_object(ptr)",
  "declare ptr @fsh_rt_insp_error(ptr, ptr, ptr)",
  "declare void @fsh_rt_insp_field(ptr, ptr, ptr)",
  "declare ptr @fsh_rt_insp_list(i32, i64)",
  "declare void @fsh_rt_insp_push(ptr, ptr)",
  "declare void @fsh_rt_insp_append(ptr, ptr)",
  "declare ptr @fsh_rt_insp_variant(ptr)",
  "declare ptr @fsh_rt_insp_done(ptr)",
  "declare void @fsh_rt_sleep_cancel(ptr, ptr)",
  "declare ptr @fsh_rt_array_zeroed(i64)",
  "declare ptr @fsh_rt_text_new()",
  "declare void @fsh_rt_text_add(ptr, ptr)",
  "declare void @fsh_rt_text_raw(ptr, ptr)",
  "declare void @fsh_rt_text_i64(ptr, i64)",
  "declare void @fsh_rt_text_i128(ptr, i128)",
  "declare void @fsh_rt_text_u128(ptr, i128)",
  "declare void @fsh_rt_text_u64(ptr, i64)",
  "declare void @fsh_rt_text_f64(ptr, double)",
  "declare void @fsh_rt_text_f32(ptr, float)",
  "declare ptr @fsh_rt_text_done(ptr)",
  "declare ptr @fsh_rt_format(ptr, i64, ptr)",
  "declare ptr @fsh_rt_inspect(ptr)",
  "declare void @fsh_rt_args(i32, ptr)",
  "declare i64 @fsh_rt_date_now()",
  "declare i32 @fsh_rt_file_poll(ptr, ptr, ptr, i32, ptr, ptr, ptr)",
  "declare void @fsh_rt_file_job_release(ptr)",
  "declare double @fsh_rt_performance_now()",
  "declare double @fsh_rt_math_random()",
  "",
  '@.true = private unnamed_addr constant [5 x i8] c"true\\00"',
  '@.false = private unnamed_addr constant [6 x i8] c"false\\00"',
];

// `console.log` and `print` are the same: arguments joined by spaces, then a newline. String
// literals and literal values are folded into the printf format at compile time. A union is
// printed by branching on its tag, so the format is flushed before it and each branch prints
// its member.
export function print(args: Expr[], b: Slots, value: (e: Expr) => string, typeOf: (e: Expr) => Type, convert: Convert, stream: 1 | 2 = 1) {
  // Every argument runs before anything prints, as in JavaScript.
  const evaluated = args.map((a) => (a.kind === "string" ? "" : value(a)));
  write(stream, args.map((a, i) => (a.kind === "string" ? a.value : [evaluated[i]!, typeOf(a)])), b, convert);
}

// Writes text and values, joined by spaces and ending in a newline, to stdout (1) or stderr (2).
// A value of a type with no printed form, like an object, prints as its type's name.
export function write(stream: 1 | 2, parts: (string | [string, Type])[], b: Slots, convert: Convert) {
  const { emit, temp, label, startBlock, cString, typing } = b;
  const llvm = layoutOf(typing);
  let format = "";
  let values: string[] = [];
  emit(`call void @fsh_rt_print_begin(i32 ${stream})`);
  parts.forEach((part, i) => {
    if (i > 0) format += " ";
    if (typeof part === "string") literal(part);
    else piece(...part);
  });
  format += "\n";
  flush();
  emit(`call void @fsh_rt_print_end(i32 ${stream})`);

  function piece(v: string, type: Type) {
    // Objects, arrays, Maps, Sets and unions holding them print as Node's util.inspect would.
    const plain = (t: Type): boolean => {
      if (typeof t === "string") return true;
      const r = typing.rec(t);
      return r.kind === "literal" || r.kind === "pattern" || (r.kind === "union" && r.members.every(plain));
    };
    const r = typeof type === "string" ? undefined : typing.rec(type);
    if (!plain(type) && b.inspect) {
      flush();
      const text = b.inspect(v, type);
      emit(`call void @fsh_rt_str_print(i32 ${stream}, ptr ${text})`);
      emit(`call void @fsh_rt_str_release(ptr ${text})`);
    } else if (r?.kind === "literal") {
      literal(String(r.value));
    } else if (type === "string") {
      // Written by the runtime, since its bytes may hold anything printf would read as format.
      flush();
      emit(`call void @fsh_rt_str_print(i32 ${stream}, ptr ${v})`);
    } else if (type === "bigint") {
      // Written as console.log writes one, with its 'n'.
      flush();
      const digits = temp();
      emit(`${digits} = call ptr @fsh_rt_big_text(ptr ${v}, i64 10)`);
      emit(`call void @fsh_rt_str_print(i32 ${stream}, ptr ${digits})`);
      emit(`call void @fsh_rt_str_release(ptr ${digits})`);
      format += "n";
    } else if (type === "never") {
      // Printing never happens: the value's throw has left already.
    } else if (type === "null") {
      format += "null";
    } else if (r !== undefined && r.kind !== "union") {
      format += escape(typing.show(type));
    } else if (type === "boolean") {
      const text = temp();
      emit(`${text} = select i1 ${v}, ptr @.true, ptr @.false`);
      format += "%s";
      values.push(`, ptr ${text}`);
    } else if (r?.kind === "union") {
      flush();
      const tag = temp();
      emit(`${tag} = extractvalue ${llvm(type)} ${v}, 0`);
      const cases = r.members.map(() => label());
      const end = label();
      emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      r.members.forEach((member, i) => {
        startBlock(cases[i]!);
        piece(convert(v, type, member), member);
        flush();
        emit(`br label %${end}`);
      });
      startBlock(end);
    } else if (type === "f32" || type === "f64") {
      // A float is written out by the runtime, as JavaScript would.
      const text = temp();
      emit(`${text} = call ptr @fsh_rt_format_${type}(${llvm(type)} ${v}, ptr ${b.alloca("[32 x i8]")})`);
      format += "%s";
      values.push(`, ptr ${text}`);
    } else {
      // Every integer prints as a 64-bit one, extended by its signedness, but for the 128-bit
      // ones, which the runtime writes.
      const { bits, signed } = INTEGERS[type as Integer];
      if (bits === 128) {
        const text = temp();
        emit(`${text} = call ptr @fsh_rt_format_${signed ? "i" : "u"}128(i128 ${v}, ptr ${b.alloca("[41 x i8]")})`);
        format += "%s";
        values.push(`, ptr ${text}`);
        return;
      }
      let wide = v;
      if (bits < 64) {
        wide = temp();
        emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
      format += signed ? "%lld" : "%llu";
      values.push(`, i64 ${wide}`);
    }
  }

  // Text holding a NUL would end printf's format early, so the runtime writes it.
  function literal(text: string) {
    if (!text.includes("\0")) {
      format += escape(text);
      return;
    }
    flush();
    emit(`call void @fsh_rt_str_print(i32 ${stream}, ptr ${b.text(text)})`);
  }

  function flush() {
    if (format === "") return;
    emit(stream === 1 ? `call i32 (ptr, ...) @printf(ptr ${cString(format)}${values.join("")})` : `call i32 (i32, ptr, ...) @dprintf(i32 2, ptr ${cString(format)}${values.join("")})`);
    format = "";
    values = [];
  }
}

const escape = (text: string) => text.replaceAll("%", "%%");

type Convert = (v: string, from: Type, to: Type) => string;
