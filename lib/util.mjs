// Shared helpers: answer extraction and small deterministic utilities.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fencedBlocks(text, langs) {
  const out = [];
  const re = /```([a-zA-Z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text || ''))) {
    if (!langs || langs.includes(m[1].toLowerCase())) out.push(m[2]);
  }
  return out;
}

function balancedSlices(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) { out.push(text.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  return out;
}

// Returns the last parseable JSON value in the answer (fenced blocks first).
export function extractJson(text) {
  const candidates = [...fencedBlocks(text, ['json', '']), ...balancedSlices(text || '')];
  const fenced = fencedBlocks(text, ['json', '']).length;
  const tryParse = (s) => { try { return JSON.parse(s.trim()); } catch { return undefined; } };
  for (let i = fenced - 1; i >= 0; i--) {
    const v = tryParse(candidates[i]);
    if (v !== undefined && typeof v === 'object') return v;
  }
  for (let i = candidates.length - 1; i >= fenced; i--) {
    const v = tryParse(candidates[i]);
    if (v !== undefined && typeof v === 'object') return v;
  }
  return undefined;
}

export function extractCode(text) {
  const blocks = fencedBlocks(text, ['js', 'javascript', 'mjs', 'ts', 'typescript', '']);
  return (blocks.length ? blocks[blocks.length - 1] : text || '').trim();
}

export function extractText(text) {
  const blocks = fencedBlocks(text, ['text', 'txt', '']);
  return (blocks.length ? blocks[blocks.length - 1] : text || '').trim();
}

export function extractSvg(text) {
  const m = /<svg\b[\s\S]*<\/svg>/i.exec(text || '');
  return m ? m[0] : '';
}

export const num = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,%\s원gmAh분도]/g, ''));
    return Number.isFinite(n) && v.trim() !== '' ? n : NaN;
  }
  return NaN;
};

export const sameSet = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const x = a.map(Number).sort((p, q) => p - q), y = b.map(Number).sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
};

export const isMissing = (v) => typeof v === 'string' && /없음|없다|알 수 없|확인 불가|unknown|n\/a/i.test(v);

export const round1 = (n) => Math.round(n * 10) / 10;
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
