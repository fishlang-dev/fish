// error: 'typeof make' needs make's result, worked out from its body, while the field types of 'Holder' are being worked out
class Holder { w: i64 = 7; v: ReturnType<typeof make>; constructor() { this.v = 0; } }
function make() { const h = new Holder(); return h.w; }
function main() {}
