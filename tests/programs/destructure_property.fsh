// error: a parameter property can't be destructured; it names one field
class C { constructor(public { a }: { a: i64 }) {} } function main() {}
