; Fish's own forms. TypeScript's and JavaScript's queries follow this file.

[
  "match"
  "case"
] @keyword.conditional

[
  "comptime"
  "unsafe"
  "macro"
  "move"
] @keyword.modifier

"throws" @keyword.exception

(using_declaration
  kind: "using" @keyword)

"|>" @operator

(topic) @variable.builtin

(wildcard_pattern) @variable.builtin

(variant_pattern
  name: (identifier) @constructor)

(variant_pattern
  (property_identifier) @constructor)

((type_identifier) @type.builtin
  (#match? @type.builtin "^(i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64)$"))
