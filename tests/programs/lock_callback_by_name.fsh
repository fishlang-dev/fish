// error: callbacks passed to 'update' by name
function main() {
  const n = new Lock(0);
  const bump = (v: Mut<i64>) => {
    v += 1;
  };
  n.update(bump);
}
