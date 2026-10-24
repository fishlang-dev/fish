// case: parameter_annotation
function f(a) {  // error: parameter 'a' implicitly has an 'any' type; add a type annotation
}

function main() {
}
// case: parameter_assign
function f(a: i64) {
  a = 1  // error: assigning to a parameter is not supported yet; copy it into a 'let'
}

function main() {
}
