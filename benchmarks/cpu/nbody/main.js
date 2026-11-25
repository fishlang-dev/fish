function energy(x, y, z, vx, vy, vz, mass) {
  let e = 0.0;
  for (let i = 0; i < 5; i++) {
    e += 0.5 * mass[i] * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    for (let j = i + 1; j < 5; j++) {
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      const dz = z[i] - z[j];
      e -= (mass[i] * mass[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  return e;
}

function main() {
  const pi = 3.141592653589793;
  const solar = 4.0 * pi * pi;
  const year = 365.24;
  let x = [0.0, 4.84143144246472090, 8.34336671824457987, 12.8943695621391310, 15.3796971148509165];
  let y = [0.0, -1.16032004402742839, 4.12479856412430479, -15.1111514016986312, -25.9193146099879641];
  let z = [0.0, -0.103622044471123109, -0.403523417114321381, -0.223307578892655734, 0.179258772950371181];
  let vx = [0.0, 0.00166007664274403694 * year, -0.00276742510726862411 * year, 0.00296460137564761618 * year, 0.00268067772490389322 * year];
  let vy = [0.0, 0.00769901118419740425 * year, 0.00499852801234917238 * year, 0.00237847173959480950 * year, 0.00162824170038242295 * year];
  let vz = [0.0, -0.0000690460016972063023 * year, 0.0000230417297573763929 * year, -0.0000296589568540237556 * year, -0.0000951592254519715870 * year];
  const mass = [solar, 0.000954791938424326609 * solar, 0.000285885980666130812 * solar, 0.0000436624404335156298 * solar, 0.0000515138902046611451 * solar];
  console.log(Math.round(energy(x, y, z, vx, vy, vz, mass) * 1000000.0));
  const dt = 0.01;
  for (let step = 0; step < 5000000; step++) {
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        const dx = x[i] - x[j];
        const dy = y[i] - y[j];
        const dz = z[i] - z[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        const mag = dt / (d2 * Math.sqrt(d2));
        vx[i] -= dx * mass[j] * mag;
        vy[i] -= dy * mass[j] * mag;
        vz[i] -= dz * mass[j] * mag;
        vx[j] += dx * mass[i] * mag;
        vy[j] += dy * mass[i] * mag;
        vz[j] += dz * mass[i] * mag;
      }
    }
    for (let i = 0; i < 5; i++) {
      x[i] += dt * vx[i];
      y[i] += dt * vy[i];
      z[i] += dt * vz[i];
    }
  }
  console.log(Math.round(energy(x, y, z, vx, vy, vz, mass) * 1000000.0));
}

main();
