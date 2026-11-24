/**
 * @file Fish Lang (.fsh): TypeScript's grammar with Fish's own forms added
 * @license MIT OR Apache-2.0
 */

const TypeScript = require('tree-sitter-typescript/typescript/grammar');

module.exports = grammar(TypeScript, {
  name: 'fsh',

  // `|>` binds looser than every other operator and `? :`, so it joins each list that orders them.
  precedences: ($, previous) => previous.map((list) => {
    const names = list.map((entry) => entry.value);
    const at = names.includes('ternary') ? names.indexOf('ternary') : names.indexOf('binary');
    return at < 0 ? list : [...list.slice(0, at + 1), 'pipe', ...list.slice(at + 1)];
  }).concat([
    [$.intersection_type, $.union_type, $.conditional_type, $.throws_clause],
  ]),

  conflicts: ($, previous) => previous.concat([
    [$.match_expression, $.primary_expression, $._property_name],
    [$.unsafe_statement, $.unsafe_expression],
    [$.comptime_expression, $.primary_expression],
    [$._match_single, $.primary_expression],
    [$.primary_expression, $.match_expression],
    [$.primary_expression, $._property_name, $.comptime_expression],
    [$.primary_expression, $._parameter_name, $.comptime_expression],
    [$.call_expression, $.binary_expression, $.instantiation_expression, $.comptime_expression],
    [$.primary_expression, $.unsafe_expression],
    [$.expression_statement, $.unsafe_expression],
    [$.primary_expression, $.arrow_function, $.method_definition],
    [$.call_expression, $.binary_expression, $.instantiation_expression, $.throw_expression],
    [$.import, $.import_type],
  ]),

  rules: {
    statement: ($, previous) => choice(
      previous,
      $.comptime_statement,
      $.unsafe_statement,
    ),

    declaration: ($, previous) => choice(
      previous,
      $.macro_declaration,
      $.decorated_declaration,
      $.using_declaration,
    ),

    // `using file = open(path)` keeps a value to the end of its scope, where its disposer runs. It
    // binds plain names only, so `using[0]` and `using as T` stay expressions. `await using` awaits
    // the value's async disposer there; before anything but a name it awaits a value named `using`.
    using_declaration: $ => seq(
      optional(field('await', 'await')),
      field('kind', 'using'),
      commaSep1(alias($._using_declarator, $.variable_declarator)),
      $._semicolon,
    ),

    _using_declarator: $ => seq(
      field('name', $.identifier),
      field('type', optional($.type_annotation)),
      optional($._initializer),
    ),

    // TypeScript's grammar reads `using x = y` as an assignment with a word before it; here the
    // declaration above takes it.
    assignment_expression: $ => prec.right('assign', seq(
      field('left', choice($.parenthesized_expression, $._lhs_expression)),
      '=',
      field('right', $.expression),
    )),

    // Macros and derives apply to functions, types and enums as well as classes.
    decorated_declaration: $ => seq(
      repeat1(field('decorator', $.decorator)),
      choice($.function_declaration, $.generator_function_declaration, $.type_alias_declaration, $.enum_declaration, $.interface_declaration),
    ),

    enum_declaration: $ => seq(
      optional('const'),
      'enum',
      field('name', $.identifier),
      field('type_parameters', optional($.type_parameters)),
      field('body', $.enum_body),
    ),

    enum_body: $ => seq(
      '{',
      optional(seq(
        commaSep1(choice(field('name', $._property_name), $.enum_assignment, $.enum_variant)),
        optional(','),
      )),
      '}',
    ),

    // `Circle(f64)`: a variant carrying values.
    enum_variant: $ => seq(field('name', $._property_name), '(', commaSep($.type), optional(','), ')'),

    // `x ?? throw err`, as the TC39 proposal has it.
    throw_expression: $ => prec.right('unary_void', seq('throw', field('argument', $.expression))),

    // `in` and `out` mark variance; alone, as in `Box<out>`, they are the parameter's name.
    type_parameter: $ => seq(
      optional('const'),
      optional(choice('in', 'out')),
      field('name', choice($._type_identifier, alias(choice('in', 'out'), $.type_identifier))),
      field('constraint', optional($.constraint)),
      field('value', optional($.default_type)),
    ),

    primary_type: ($, previous) => choice(previous, $.import_type, alias('asserts', $.type_identifier)),

    // `as` names a variable too, as in `let as: Type[] = []`.
    variable_declarator: ($, previous) => choice(
      previous,
      seq(
        field('name', alias('as', $.identifier)),
        field('type', optional($.type_annotation)),
        optional($._initializer),
      ),
    ),

    // `import("./m").Config<T>`
    import_type: $ => prec.right(seq(
      'import', '(', field('module', $.string), ')',
      repeat(seq('.', field('name', $._type_identifier))),
      optional(field('type_arguments', $.type_arguments)),
    )),

    // A tagged template may hold escapes a plain one refuses, as in String.raw.
    template_string: $ => seq(
      '`',
      repeat(choice(
        alias($._template_chars, $.string_fragment),
        $.escape_sequence,
        alias($._loose_escape, $.escape_sequence),
        $.template_substitution,
      )),
      '`',
    ),

    _loose_escape: _ => token.immediate(prec(-1, seq('\\', /[xu]/))),

    expression: ($, previous) => choice(
      previous,
      $.pipe_expression,
      $.comptime_expression,
      $.unsafe_expression,
      $.throw_expression,
    ),

    primary_expression: ($, previous) => choice(
      previous,
      $.match_expression,
      $.topic,
    ),

    comptime_statement: $ => prec.dynamic(1, seq('comptime', field('body', $.statement_block))),

    unsafe_statement: $ => prec.dynamic(1, seq('unsafe', field('body', $.statement_block))),

    macro_declaration: $ => seq('macro', $.function_declaration),

    // `value |> body`, looser than `? :`, with `%` standing for `value` inside `body`.
    pipe_expression: $ => prec.left('pipe', seq(
      field('left', $.expression),
      field('operator', '|>'),
      field('right', $.expression),
    )),

    topic: _ => '%',

    comptime_expression: $ => prec.right('unary_void', seq('comptime', field('argument', $.expression))),

    unsafe_expression: $ => seq('unsafe', '{', field('body', $.expression), optional(';'), '}'),

    match_expression: $ => prec.dynamic(1, seq(
      'match',
      field('subject', $.parenthesized_expression),
      '{',
      optional(seq(commaSep1($.match_arm), optional(','))),
      '}',
    )),

    match_arm: $ => seq(
      'case',
      field('pattern', $._match_pattern),
      optional(seq('if', field('guard', $.expression))),
      '=>',
      field('body', choice($.statement_block, $.expression)),
    ),

    _match_pattern: $ => choice($._match_single, $.or_pattern),

    or_pattern: $ => prec.left(seq($._match_pattern, '|', $._match_pattern)),

    _match_single: $ => choice(
      $.wildcard_pattern,
      $.identifier,
      $.variant_pattern,
      $.number,
      seq('-', $.number),
      $.string,
      $.true,
      $.false,
      $.null,
      $.object_match_pattern,
      $.array_match_pattern,
      seq('(', $._match_pattern, ')'),
    ),

    wildcard_pattern: _ => prec(1, '_'),

    // `Some(v)`, `Shape.Circle` and `Shape.Circle(r)`.
    variant_pattern: $ => prec(1, choice(
      seq(field('name', $.identifier), $._variant_arguments),
      seq(
        field('name', $.identifier),
        repeat1(seq('.', field('member', alias($.identifier, $.property_identifier)))),
        optional($._variant_arguments),
      ),
    )),

    _variant_arguments: $ => seq('(', commaSep($._match_pattern), optional(','), ')'),

    object_match_pattern: $ => seq(
      '{',
      commaSep(choice(
        seq(field('key', $._property_name), ':', field('value', $._match_pattern)),
        alias($.identifier, $.shorthand_property_identifier_pattern),
        seq('...', $._match_single),
      )),
      optional(','),
      '}',
    ),

    array_match_pattern: $ => seq(
      '[',
      repeat(seq(optional(choice($._match_pattern, seq('...', $._match_single))), ',')),
      optional(choice($._match_pattern, seq('...', $._match_single))),
      ']',
    ),

    throws_clause: $ => seq('throws', field('type', $.type)),

    _call_signature: ($, previous) => seq(previous, optional(field('throws', $.throws_clause))),

    function_type: $ => prec.left(seq(
      field('type_parameters', optional($.type_parameters)),
      field('parameters', $.formal_parameters),
      '=>',
      field('return_type', choice($.type, $.asserts, $.type_predicate)),
      optional(field('throws', $.throws_clause)),
    )),

    // `comptime n: i64` takes its argument while compiling.
    _parameter_name: ($, previous) => seq(optional('comptime'), previous),

    // `move` makes a closure take over what it captures.
    arrow_function: ($, previous) => seq(optional('move'), previous),

    _reserved_identifier: ($, previous) => choice(previous, 'match', 'comptime', 'unsafe', 'macro', 'throws', 'move', 'abstract', 'as', 'using', 'asserts', 'accessor'),
  },
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

function commaSep(rule) {
  return optional(commaSep1(rule));
}
