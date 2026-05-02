export function nowIso() {
  return new Date().toISOString();
}

export function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
