// SYNTAX TEST "source.fsh" "TypeScript forms keep TypeScript's scopes, and Fish's words stay plain where they aren't Fish's"

const match = (x: number) => x % 2;
//    ^^^^^ - keyword.control.match.fsh
//                           ^ - variable.language.topic.fsh
//                             ^ keyword.operator.arithmetic.ts

const comptime = 1;
//    ^^^^^^^^ - storage.modifier.comptime.fsh

const s = "match (x) { comptime }";
//         ^^^^^ - keyword.control.match.fsh

interface Point { x: number; y: number }
// <--------- storage.type.interface.ts
