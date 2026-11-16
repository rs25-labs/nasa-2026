import { buildLevel, type LevelJob } from './levelBuild';
import { generateRocks, type RockJob } from './rockPlacement';

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<{ id: number; kind: 'level'; job: LevelJob } | { id: number; kind: 'rocks'; job: RockJob }>) => {
  const message = event.data;
  if (message.kind === 'level') {
    const built = buildLevel(message.job);
    scope.postMessage({ id: message.id, result: built }, [built.heights.buffer, built.normals.buffer, built.maturity.buffer, built.detail.buffer]);
  } else {
    const set = generateRocks(message.job);
    scope.postMessage({ id: message.id, result: set }, set.data.map((array) => array.buffer));
  }
};
