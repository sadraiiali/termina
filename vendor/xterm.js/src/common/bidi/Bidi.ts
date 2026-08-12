/**
 * Copyright (c) 2026 The xterm.js authors / project patches. All rights reserved.
 * @license MIT
 *
 * RTL helpers inspired by iTerm2 PR #709.
 *
 * Critical DOM rule: never reverse Arabic/Persian *code points* for display.
 * Joining/shaping requires logical order. Emit directional *runs* as spans with
 * `direction: rtl|ltr` and keep logical text inside each run.
 *
 * Selection still uses a visual↔logical cell map (RTL runs reversed for hit-testing).
 */

const ZW_FORMAT = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g;

export interface BidiOptions {
  enabled: boolean;
  latinIslands?: boolean;
  keepGuillemetsAsTyped?: boolean;
}

export type ResolvedDir = 'L' | 'R';

export interface BidiRun {
  /** Inclusive start logical cell index */
  start: number;
  /** Exclusive end logical cell index */
  end: number;
  dir: ResolvedDir;
}

export interface BidiLineInfo {
  isRtlParagraph: boolean;
  hasRtl: boolean;
  /** Per logical cell resolved embedding direction */
  resolved: ResolvedDir[];
  /** Directional runs in logical order */
  runs: BidiRun[];
  /**
   * Visual left→right order of logical cell indices.
   * Used only for mouse selection mapping (RTL runs reversed).
   */
  visualOrder: number[];
  logicalForVisual: Int32Array;
  visualForLogical: Int32Array;
}

export type StrongDir = 'L' | 'R' | 'N';

export function isRtlCodePoint(cp: number): boolean {
  if (cp >= 0x0590 && cp <= 0x05FF) return true;
  if (cp >= 0x0600 && cp <= 0x06FF) return true;
  if (cp >= 0x0750 && cp <= 0x077F) return true;
  if (cp >= 0x08A0 && cp <= 0x08FF) return true;
  if (cp >= 0xFB50 && cp <= 0xFDFF) return true;
  if (cp >= 0xFE70 && cp <= 0xFEFF) return true;
  return false;
}

export function isLtrLetter(cp: number): boolean {
  if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) return true;
  if (cp >= 0x00C0 && cp <= 0x024F) return true;
  return false;
}

export function strongDirectionOfChar(ch: string): StrongDir {
  if (!ch) return 'N';
  const cp = ch.codePointAt(0)!;
  if (isRtlCodePoint(cp)) return 'R';
  if (isLtrLetter(cp)) return 'L';
  if (cp >= 0x30 && cp <= 0x39) return 'L';
  return 'N';
}

export function detectParagraphDirection(chars: string[]): 'L' | 'R' {
  let first: StrongDir | null = null;
  let rtl = 0;
  let ltr = 0;
  for (const ch of chars) {
    const d = strongDirectionOfChar(ch);
    if (d === 'N') continue;
    if (!first) first = d;
    if (d === 'R') rtl++;
    else ltr++;
  }
  if (!first) return 'L';
  if (first === 'R' && rtl >= ltr) return 'R';
  if (first === 'L' && ltr >= rtl) return 'L';
  return first === 'R' ? 'R' : 'L';
}

/** N1: neutrals between two same strong dirs take that dir; else paragraph. */
function resolveNeutrals(dirs: StrongDir[], para: ResolvedDir): ResolvedDir[] {
  const n = dirs.length;
  const strong: Array<ResolvedDir | null> = dirs.map(d => (d === 'N' ? null : d));

  for (let i = 0; i < n; ) {
    if (strong[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && strong[j] === null) j++;

    let before: ResolvedDir | null = null;
    for (let k = i - 1; k >= 0; k--) {
      if (strong[k]) {
        before = strong[k];
        break;
      }
    }
    let after: ResolvedDir | null = null;
    for (let k = j; k < n; k++) {
      if (strong[k]) {
        after = strong[k];
        break;
      }
    }
    const fill: ResolvedDir = before && after && before === after ? before : para;
    for (let k = i; k < j; k++) strong[k] = fill;
    i = j;
  }
  return strong.map(s => s ?? para);
}

function markLatinIslands(chars: string[], resolved: ResolvedDir[], para: ResolvedDir): void {
  if (para !== 'R') return;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    const cp = ch.codePointAt(0)!;
    if (cp < 128 && ch !== ' ' && ch !== '\t') {
      let j = i;
      let hasLetter = false;
      while (j < chars.length) {
        const c = chars[j];
        const p = c.codePointAt(0)!;
        if (p >= 128 || c === ' ' || c === '\t') break;
        if (isLtrLetter(p)) hasLetter = true;
        j++;
      }
      if (hasLetter) {
        for (let k = i; k < j; k++) resolved[k] = 'L';
        i = j;
        continue;
      }
    }
    i++;
  }
}

function identityInfo(n: number): BidiLineInfo {
  const visualOrder = Array.from({ length: n }, (_, i) => i);
  const logicalForVisual = new Int32Array(n);
  const visualForLogical = new Int32Array(n);
  const resolved: ResolvedDir[] = Array(n).fill('L');
  for (let i = 0; i < n; i++) {
    logicalForVisual[i] = i;
    visualForLogical[i] = i;
  }
  return {
    isRtlParagraph: false,
    hasRtl: false,
    resolved,
    runs: n ? [{ start: 0, end: n, dir: 'L' }] : [],
    visualOrder,
    logicalForVisual,
    visualForLogical
  };
}

/**
 * Analyze a terminal line (one string per cell).
 */
export function analyzeLine(chars: string[], options: BidiOptions): BidiLineInfo {
  const n = chars.length;
  if (!options.enabled || n === 0) return identityInfo(n);

  const normalized = chars.map(c => (!c || c === '\0' ? ' ' : c));

  let hasRtl = false;
  for (const ch of normalized) {
    if (strongDirectionOfChar(ch) === 'R') {
      hasRtl = true;
      break;
    }
  }
  if (!hasRtl) return identityInfo(n);

  const para = detectParagraphDirection(normalized);
  const raw = normalized.map(ch => strongDirectionOfChar(ch));
  const resolved = resolveNeutrals(raw, para);
  if (options.latinIslands) markLatinIslands(normalized, resolved, para);

  // Logical runs
  const runs: BidiRun[] = [];
  let rs = 0;
  while (rs < n) {
    const d = resolved[rs];
    let re = rs + 1;
    while (re < n && resolved[re] === d) re++;
    runs.push({ start: rs, end: re, dir: d });
    rs = re;
  }

  // Visual cell order for selection: reverse cells inside RTL runs only
  // (rendering keeps logical text; this map is for hit-testing)
  const visualOrder: number[] = [];
  if (para === 'R') {
    // RTL paragraph: reverse run order, reverse cells inside LTR runs only? UBA L2:
    // reverse contiguous sequences of odd levels. Simplified: reverse all run order,
    // within each run reverse if dir===R? Actually for RTL base, whole line is mostly R.
    // Visual left→right: reverse of logical for pure RTL.
    // Mixed: reverse run sequence, keep L runs internal order, reverse R run internals for map.
    for (let ri = runs.length - 1; ri >= 0; ri--) {
      const run = runs[ri];
      if (run.dir === 'R') {
        for (let i = run.end - 1; i >= run.start; i--) visualOrder.push(i);
      } else {
        for (let i = run.start; i < run.end; i++) visualOrder.push(i);
      }
    }
  } else {
    for (const run of runs) {
      if (run.dir === 'R') {
        for (let i = run.end - 1; i >= run.start; i--) visualOrder.push(i);
      } else {
        for (let i = run.start; i < run.end; i++) visualOrder.push(i);
      }
    }
  }

  const logicalForVisual = new Int32Array(n);
  const visualForLogical = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const l = visualOrder[v] ?? v;
    logicalForVisual[v] = l;
    visualForLogical[l] = v;
  }

  return {
    isRtlParagraph: para === 'R',
    hasRtl: true,
    resolved,
    runs,
    visualOrder,
    logicalForVisual,
    visualForLogical
  };
}

export function analyzeCells(cellChars: string[], options: BidiOptions): BidiLineInfo {
  return analyzeLine(cellChars, options);
}

export function stripZeroWidthFormatChars(text: string): string {
  return text.replace(ZW_FORMAT, '');
}

/** @deprecated Display must not mirror via reverse; kept for tests / optional. */
export function mirrorCharForDisplay(ch: string, _inRtlRun: boolean, _keepG = true): string {
  return ch;
}
