// mode: parse
function f() {
  let simple = /ab+c/
  let flags = /^hello$/gimsuy
  let slashInClass = /[/]+/
  let bracketInClass = /[\]a-z]/
  let escaped = /\/\d+\//
  let quote = /'/
  let backtick = /`/
  let hash = /#\s*$/
  let inTemplate = `${/}/.test(x)} done`
  let divides = a / b / c
  let assignDivide = /=+/
  let call = check(/x/, /y/g)
  let parens = (/a/)
}
