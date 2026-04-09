const HIDDEN_WORKER_IDS = new Set(['w003', 'w004', 'w005']);

const HIDDEN_WORKER_NAMES = new Set([
  'priya shinde',
  'anita more',
  'mahesh kale',
  'soham',
  'vidushi bhardwaj',
]);

export function isHiddenWorker(workerId?: string | null, workerName?: string | null): boolean {
  const normalizedName = (workerName ?? '').trim().toLowerCase();
  return (
    (workerId ? HIDDEN_WORKER_IDS.has(workerId) : false) ||
    (normalizedName.length > 0 && HIDDEN_WORKER_NAMES.has(normalizedName))
  );
}
