// SYNTAX TEST "source.fsh" "Fish's own forms"

const label = match (shape) {
//            ^^^^^ keyword.control.match.fsh
  case Circle(r) if r > 0 => "round",
  case _ => "other",
//     ^ variable.language.wildcard.fsh
};

const n = xs |> sum(%) |> double(%);
//           ^^ keyword.operator.pipe.fsh
//                  ^ variable.language.topic.fsh
//                                ^ variable.language.topic.fsh

const size = comptime fib(10);
//           ^^^^^^^^ storage.modifier.comptime.fsh

comptime {
// <-------- storage.modifier.comptime.fsh
  console.log("while compiling");
}

const p = unsafe { raw.read() };
//        ^^^^^^ storage.modifier.unsafe.fsh

macro function derive(ast: Ast): Ast {
// <----- storage.modifier.macro.fsh
  return ast;
}

function parse(s: string): i64 throws ParseError {
//                         ^^^ support.type.primitive.fsh
//                             ^^^^^^ storage.modifier.throws.fsh
  return 0;
}

const f = move (x: u8) => x;
//        ^^^^ storage.modifier.move.fsh
//                 ^^ support.type.primitive.fsh

function first(xs: Ref<string[]>): Option<string> {
//                 ^^^ support.class.builtin.fsh
//                                 ^^^^^^ support.class.builtin.fsh
  return None;
//       ^^^^ support.class.builtin.fsh
}
