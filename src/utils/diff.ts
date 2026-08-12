/**
 * Line diff based on a Myers-style LCS over hashed lines.
 *
 * Kept O(n·m) but bounded: inputs are capped by the caller, and above
 * `MAX_CELLS` we degrade to a cheap prefix/suffix + block diff so a large
 * paste can never stall the Worker.
 */

export type DiffOp = 'equal' | 'add' | 'remove' | 'change';

export interface DiffRow {
  op: DiffOp;
  /** 1-based line number in the original text (undefined for pure additions). */
  oldLine?: number;
  /** 1-based line number in the new text (undefined for pure removals). */
  newLine?: number;
  oldText?: string;
  newText?: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** Percentage of similarity between the two inputs, 0–100. */
  similarity: number;
}

export interface DiffResult {
  rows: DiffRow[];
  stats: DiffStats;
  /** True when the LCS was skipped because the inputs were too large. */
  degraded: boolean;
}

const MAX_CELLS = 4_000_000;

function lcsTable(a: string[], b: string[]): Uint32Array {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + (j + 1)] as number) + 1
          : Math.max(table[(i + 1) * cols + j] as number, table[i * cols + (j + 1)] as number);
    }
  }
  return table;
}

/** Pairs consecutive remove+add runs into `change` rows so output stays compact. */
function coalesce(rows: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] as DiffRow;
    if (row.op !== 'remove') {
      out.push(row);
      i += 1;
      continue;
    }
    const removes: DiffRow[] = [];
    while (i < rows.length && (rows[i] as DiffRow).op === 'remove') {
      removes.push(rows[i] as DiffRow);
      i += 1;
    }
    const adds: DiffRow[] = [];
    while (i < rows.length && (rows[i] as DiffRow).op === 'add') {
      adds.push(rows[i] as DiffRow);
      i += 1;
    }
    const paired = Math.min(removes.length, adds.length);
    for (let k = 0; k < paired; k += 1) {
      const rem = removes[k] as DiffRow;
      const add = adds[k] as DiffRow;
      out.push({
        op: 'change',
        ...(rem.oldLine !== undefined ? { oldLine: rem.oldLine } : {}),
        ...(add.newLine !== undefined ? { newLine: add.newLine } : {}),
        oldText: rem.oldText ?? '',
        newText: add.newText ?? '',
      });
    }
    for (let k = paired; k < removes.length; k += 1) out.push(removes[k] as DiffRow);
    for (let k = paired; k < adds.length; k += 1) out.push(adds[k] as DiffRow);
  }
  return out;
}

export interface DiffOptions {
  ignoreCase?: boolean;
  ignoreWhitespace?: boolean;
}

export function diffLines(original: string, updated: string, options: DiffOptions = {}): DiffResult {
  const a = original.split(/\r?\n/);
  const b = updated.split(/\r?\n/);

  const key = (line: string): string => {
    let value = line;
    if (options.ignoreWhitespace) value = value.replace(/\s+/g, ' ').trim();
    if (options.ignoreCase) value = value.toLowerCase();
    return value;
  };
  const ka = a.map(key);
  const kb = b.map(key);

  const rows: DiffRow[] = [];
  let degraded = false;

  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    degraded = true;
    // Cheap fallback: match common prefix / suffix, treat the middle as a block change.
    let prefix = 0;
    while (prefix < ka.length && prefix < kb.length && ka[prefix] === kb[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < ka.length - prefix &&
      suffix < kb.length - prefix &&
      ka[ka.length - 1 - suffix] === kb[kb.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    for (let i = 0; i < prefix; i += 1) {
      rows.push({ op: 'equal', oldLine: i + 1, newLine: i + 1, oldText: a[i] as string, newText: b[i] as string });
    }
    for (let i = prefix; i < a.length - suffix; i += 1) {
      rows.push({ op: 'remove', oldLine: i + 1, oldText: a[i] as string });
    }
    for (let j = prefix; j < b.length - suffix; j += 1) {
      rows.push({ op: 'add', newLine: j + 1, newText: b[j] as string });
    }
    for (let k = 0; k < suffix; k += 1) {
      const i = a.length - suffix + k;
      const j = b.length - suffix + k;
      rows.push({ op: 'equal', oldLine: i + 1, newLine: j + 1, oldText: a[i] as string, newText: b[j] as string });
    }
  } else {
    const cols = kb.length + 1;
    const table = lcsTable(ka, kb);
    let i = 0;
    let j = 0;
    while (i < ka.length && j < kb.length) {
      if (ka[i] === kb[j]) {
        rows.push({ op: 'equal', oldLine: i + 1, newLine: j + 1, oldText: a[i] as string, newText: b[j] as string });
        i += 1;
        j += 1;
      } else if ((table[(i + 1) * cols + j] as number) >= (table[i * cols + (j + 1)] as number)) {
        rows.push({ op: 'remove', oldLine: i + 1, oldText: a[i] as string });
        i += 1;
      } else {
        rows.push({ op: 'add', newLine: j + 1, newText: b[j] as string });
        j += 1;
      }
    }
    while (i < ka.length) {
      rows.push({ op: 'remove', oldLine: i + 1, oldText: a[i] as string });
      i += 1;
    }
    while (j < kb.length) {
      rows.push({ op: 'add', newLine: j + 1, newText: b[j] as string });
      j += 1;
    }
  }

  const merged = coalesce(rows);
  const stats: DiffStats = {
    added: merged.filter((r) => r.op === 'add').length,
    removed: merged.filter((r) => r.op === 'remove').length,
    changed: merged.filter((r) => r.op === 'change').length,
    unchanged: merged.filter((r) => r.op === 'equal').length,
    similarity: 0,
  };
  const total = stats.added + stats.removed + stats.changed + stats.unchanged;
  stats.similarity = total === 0 ? 100 : Math.round((stats.unchanged / total) * 1000) / 10;
  return { rows: merged, stats, degraded };
}
