function text(value) {
  return typeof value === "string" ? value : "";
}

export function compareEffectRecords(a, b) {
  const createdAt = text(a?.created_at).localeCompare(text(b?.created_at));
  if (createdAt !== 0) return createdAt;
  return text(a?.effect_id).localeCompare(text(b?.effect_id));
}
