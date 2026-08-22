// Bot Ecosystem V14 -- gemeinsame Hilfsfunktionen fuer alle analyze-v14-*.js
// Skripte. Reine Analyse-Utilities, keine Simulation.
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length)));
  return sortedArr[idx];
}
function gini(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0 || n === 0) return 0;
  let cum = 0;
  s.forEach((v, i) => { cum += (i + 1) * v; });
  return round((2 * cum) / (n * sum) - (n + 1) / n, 3);
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n === 0 || n !== ys.length) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  if (dx2 === 0 || dy2 === 0) return null;
  return round(num / Math.sqrt(dx2 * dy2), 3);
}
function findSnap(run, season) { return run.powerSnapshots.find((s) => s.season === season); }
function rowByName(snap, name) { return snap ? snap.rows.find((r) => r.name === name) : null; }
function stddev(arr) {
  const m = mean(arr);
  if (m === null) return null;
  return round(Math.sqrt(mean(arr.map((v) => (v - m) * (v - m)))), 2);
}

module.exports = { loadRun, round, mean, percentile, gini, pearson, findSnap, rowByName, stddev, fs, path };
