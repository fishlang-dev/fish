macro function rename(input: AstStmt): AstStmt {
  let d = input;
  if (d.kind === "function") d.name = `${d.name}Renamed`;
  return d;
}
@rename export function named(): string { return "renamed"; }
