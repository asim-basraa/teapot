export type DiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
};

/**
 * A line diff between two versions of a document.
 *
 * Written here rather than pulled in, because the useful part is small and the
 * shape of the answer matters more than the algorithm: a list of lines each
 * marked kept, added or removed, which is exactly what the history panel
 * renders and exactly what a test can assert on.
 *
 * A longest-common-subsequence table, which is the textbook answer and is
 * quadratic in the number of lines. That is the right trade at this size: a
 * page is hundreds of lines, not hundreds of thousands, and the alternative
 * algorithms buy speed by being much harder to be sure of.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = split(before);
  const b = split(after);

  // lengths[i][j] is the length of the longest common subsequence of a[i:]
  // and b[j:]. Built from the end so the walk below can go forwards, which is
  // the order the result has to come out in.
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      // Removals before additions where both are possible, so a changed line
      // reads as the old one struck out and the new one under it.
      out.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }

  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });

  return out;
}

/** How many lines each way, for a one-line summary above the diff. */
export function diffSummary(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  return {
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}

/**
 * Splits into lines without inventing a trailing empty one.
 *
 * "a\n" is one line, not two. Getting this wrong makes every diff against a
 * file that ends in a newline report a spurious change on its last line.
 */
function split(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
