/**
 * Extend a height tile over cells the data does not cover (outside the polar product's edge), so the far terrain continues to the
 * level's border and the horizon is a smooth ridge line instead of a staircase of dropped grid cells. Each missing cell takes the
 * mean of the filled cells around it, working outward from the data edge one ring at a time, and the extension is then relaxed
 * with a few blurs so no streaks run away from the edge. Cells with data are never changed. Returns false when there is no data.
 */
export function fillGaps(heights: Float32Array, size: number): boolean {
  const total = size * size;
  const filled = new Uint8Array(total);
  let known = 0;
  for (let k = 0; k < total; k += 1) {
    if (Number.isFinite(heights[k])) {
      filled[k] = 1;
      known += 1;
    }
  }
  if (known === 0) return false;
  if (known === total) return true;

  const added = new Uint8Array(total);
  const queued = new Uint8Array(total);
  let frontier: number[] = [];
  const neighbours = (k: number, visit: (other: number) => void): void => {
    const i = k % size;
    const j = (k - i) / size;
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
        visit(nj * size + ni);
      }
    }
  };
  for (let k = 0; k < total; k += 1) {
    if (filled[k]) continue;
    let touches = false;
    neighbours(k, (other) => {
      if (filled[other]) touches = true;
    });
    if (touches) {
      frontier.push(k);
      queued[k] = 1;
    }
  }
  while (frontier.length > 0) {
    const values = new Float32Array(frontier.length);
    for (let m = 0; m < frontier.length; m += 1) {
      let sum = 0;
      let count = 0;
      neighbours(frontier[m] as number, (other) => {
        if (filled[other]) {
          sum += heights[other] as number;
          count += 1;
        }
      });
      values[m] = sum / count;
    }
    const next: number[] = [];
    for (let m = 0; m < frontier.length; m += 1) {
      const k = frontier[m] as number;
      heights[k] = values[m] as number;
      filled[k] = 1;
      added[k] = 1;
    }
    for (const k of frontier) {
      neighbours(k, (other) => {
        if (!filled[other] && !queued[other]) {
          queued[other] = 1;
          next.push(other);
        }
      });
    }
    frontier = next;
  }

  const scratch = new Float32Array(total);
  for (let pass = 0; pass < 6; pass += 1) {
    scratch.set(heights);
    for (let k = 0; k < total; k += 1) {
      if (!added[k]) continue;
      let sum = heights[k] as number;
      let count = 1;
      neighbours(k, (other) => {
        sum += heights[other] as number;
        count += 1;
      });
      scratch[k] = sum / count;
    }
    heights.set(scratch);
  }
  return true;
}
