let lastNowMs = 0;

export function nowIso() {
  const currentMs = Date.now();
  const nextMs = currentMs <= lastNowMs ? lastNowMs + 1 : currentMs;
  lastNowMs = nextMs;
  return new Date(nextMs).toISOString();
}

export function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
