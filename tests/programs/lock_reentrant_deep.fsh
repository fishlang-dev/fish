// panic: this lock is already held by an `update` running here
function main() {
  const l0 = new Lock(0);
  const l1 = new Lock(0);
  const l2 = new Lock(0);
  const l3 = new Lock(0);
  const l4 = new Lock(0);
  const l5 = new Lock(0);
  const l6 = new Lock(0);
  const l7 = new Lock(0);
  const l8 = new Lock(0);
  const l9 = new Lock(0);
  const l10 = new Lock(0);
  const l11 = new Lock(0);
  const l12 = new Lock(0);
  const l13 = new Lock(0);
  const l14 = new Lock(0);
  const l15 = new Lock(0);
  const l16 = new Lock(0);
  const r = l0.update((v0) => l1.update((v1) => l2.update((v2) => l3.update((v3) => l4.update((v4) => l5.update((v5) => l6.update((v6) => l7.update((v7) => l8.update((v8) => l9.update((v9) => l10.update((v10) => l11.update((v11) => l12.update((v12) => l13.update((v13) => l14.update((v14) => l15.update((v15) => l16.update((v16) => l16.update((w) => 1))))))))))))))))));
  console.log(r);
}
