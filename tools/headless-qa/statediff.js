// Save/Load Integrity V1 -- struktureller State-Diff + deterministischer
// Gameplay-State-Hash. Wird SOWOHL vom Node-Host (require) ALS AUCH per
// Quelltext-Injektion in den Headless-VM-Context genutzt (siehe
// roundtrip-test.js) -- deshalb bewusst ohne Dependencies, reines JS.
function compareGameStates(before, after, ignoredPaths) {
  ignoredPaths = ignoredPaths || [];
  const diffs = [];
  function isIgnored(path) {
    return ignoredPaths.some((p) => path === p || path.startsWith(p + '.') || path.startsWith(p + '['));
  }
  function walk(a, b, path) {
    if (isIgnored(path)) return;
    if (a === b) return;
    if (typeof a === 'number' && typeof b === 'number') {
      if (Number.isNaN(a) && Number.isNaN(b)) return;
      if (a !== b) diffs.push({ path, before: a, after: b });
      return;
    }
    if (a === null || b === null || a === undefined || b === undefined) {
      diffs.push({ path, before: a, after: b });
      return;
    }
    if (typeof a !== typeof b) { diffs.push({ path, before: a, after: b }); return; }
    if (typeof a !== 'object') {
      if (a !== b) diffs.push({ path, before: a, after: b });
      return;
    }
    if (Array.isArray(a) !== Array.isArray(b)) { diffs.push({ path, before: a, after: b }); return; }
    if (Array.isArray(a)) {
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) walk(a[i], b[i], path + '[' + i + ']');
      return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach((k) => walk(a[k], b[k], path ? path + '.' + k : k));
  }
  walk(before, after, '');
  return diffs;
}

// Deterministischer Hash NUR über persistenzrelevante Gameplay-Felder (kein
// UI-/Session-Zustand). Bewusst simpel (FNV-1a über JSON.stringify mit
// SORTIERTEN Keys, damit Objekt-Property-Reihenfolge -- die laut Auftrag
// EGAL sein soll -- den Hash nicht beeinflusst) -- kein kryptographischer
// Anspruch, nur Drift-Erkennung.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
function computeGameplayStateHash(relevantState) {
  return fnv1a(stableStringify(relevantState));
}

if (typeof module !== 'undefined') module.exports = { compareGameStates, computeGameplayStateHash, stableStringify, fnv1a };
