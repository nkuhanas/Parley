import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

const fileLockQueues = new Map();
const heldFileLocks = new AsyncLocalStorage();

function lockKey(filePath) {
  return path.resolve(filePath);
}

export async function withFileLock(filePath, operation) {
  const key = lockKey(filePath);
  const held = heldFileLocks.getStore();
  if (held?.has(key)) return operation();

  const previous = fileLockQueues.get(key) ?? Promise.resolve();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => pending);
  fileLockQueues.set(key, next);

  await previous.catch(() => undefined);
  const nextHeld = new Set(held ?? []);
  nextHeld.add(key);
  try {
    return await heldFileLocks.run(nextHeld, operation);
  } finally {
    release();
    if (fileLockQueues.get(key) === next) fileLockQueues.delete(key);
  }
}
