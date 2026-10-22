function main() { const xs = [10]; const o: Option<Ptr<i64>> = ptrOf(xs[0]); const v = unsafe { o?.read() }; }
// error: optional chains calling raw pointer methods are not supported yet
