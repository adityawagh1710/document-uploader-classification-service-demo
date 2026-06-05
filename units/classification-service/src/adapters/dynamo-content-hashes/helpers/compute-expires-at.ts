const SECONDS_PER_DAY = 86_400;

// Pure: (ISO timestamp, days) -> unix seconds.
// Verified by PBT-U2-002 within ±1s tolerance.
export function computeExpiresAt(firstSeenAtIso: string, ttlDays: number): number {
  const epochMs = Date.parse(firstSeenAtIso);
  if (Number.isNaN(epochMs)) {
    throw new RangeError(`computeExpiresAt: invalid ISO timestamp "${firstSeenAtIso}"`);
  }
  return Math.floor(epochMs / 1000) + ttlDays * SECONDS_PER_DAY;
}
