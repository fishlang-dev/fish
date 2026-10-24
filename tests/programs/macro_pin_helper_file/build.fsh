function secretName(): string { return "from build"; }
export function make(): AstStmt {
  return quote`function ${ident("describe")}(): string { return secretName(); }`;
}
