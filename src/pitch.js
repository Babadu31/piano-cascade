export function yin(buf, sr, d) {
  const W = buf.length >> 1;
  const tMin = Math.floor(sr / 2200), tMax = Math.min(Math.ceil(sr / 55), buf.length - W - 1);
  d = d || new Float32Array(tMax + 2);
  for (let tau = 1; tau <= tMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const x = buf[j] - buf[j + tau]; s += x * x; }
    d[tau] = s;
  }
  let run = 0; d[0] = 1;
  for (let tau = 1; tau <= tMax; tau++) { run += d[tau]; d[tau] = run > 0 ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = tMin; t <= tMax; t++) {
    if (d[t] < 0.15) { while (t + 1 <= tMax && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) return null;
  let better = tau;
  if (tau > 1 && tau < tMax) {
    const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1], den = s0 + s2 - 2 * s1;
    if (den !== 0) better = tau + (s0 - s2) / (2 * den);
  }
  return { freq: sr / better, conf: 1 - d[tau] };
}
