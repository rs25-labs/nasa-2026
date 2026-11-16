import type { BuiltLevel, LevelJob } from './levelBuild';
import type { RockJob, RockSet } from './rockPlacement';

interface Waiting {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** A few workers that build terrain levels and rock fields off the main thread. */
export class DetailPool {
  private readonly workers: Worker[] = [];
  private readonly load: number[] = [];
  private readonly waiting = new Map<number, Waiting & { worker: number }>();
  private nextId = 1;

  constructor(count = 3) {
    for (let k = 0; k < count; k += 1) {
      const worker = new Worker(new URL('./detailWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ id: number; result: unknown }>) => {
        const entry = this.waiting.get(event.data.id);
        if (!entry) return;
        this.waiting.delete(event.data.id);
        this.load[entry.worker] = (this.load[entry.worker] ?? 1) - 1;
        entry.resolve(event.data.result);
      };
      worker.onerror = (event) => {
        for (const [id, entry] of this.waiting) {
          this.waiting.delete(id);
          entry.reject(new Error(event.message || 'Terrain detail worker failed.'));
        }
      };
      this.workers.push(worker);
      this.load.push(0);
    }
  }

  level(job: LevelJob): Promise<BuiltLevel> {
    return this.post('level', job) as Promise<BuiltLevel>;
  }

  rocks(job: RockJob): Promise<RockSet> {
    return this.post('rocks', job) as Promise<RockSet>;
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.waiting.clear();
  }

  private post(kind: 'level' | 'rocks', job: LevelJob | RockJob): Promise<unknown> {
    let best = 0;
    for (let k = 1; k < this.workers.length; k += 1) if ((this.load[k] as number) < (this.load[best] as number)) best = k;
    const id = this.nextId;
    this.nextId += 1;
    this.load[best] = (this.load[best] as number) + 1;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, worker: best });
      (this.workers[best] as Worker).postMessage({ id, kind, job });
    });
  }
}
