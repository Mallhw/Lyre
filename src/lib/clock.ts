// Shared clock: estimates how far this phone's clock is from the Convex
// server's, so "server time T" means the same instant on every phone.

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";
// Convex serves HTTP actions from the .convex.site twin of the .convex.cloud URL.
const TIME_URL = CONVEX_URL.replace(".convex.cloud", ".convex.site") + "/time";

// A random id for this app launch. Not stored, so a reload joins as a new phone.
export const DEVICE_ID = Math.random().toString(36).slice(2, 10);

type Sample = { offset: number; rtt: number };
let best: Sample | null = null;

/** Server time in ms, as best this phone can estimate it. */
export function serverNow(): number {
  return Date.now() + (best?.offset ?? 0);
}

export function clockInfo(): Sample | null {
  return best;
}

async function ping(): Promise<Sample | null> {
  try {
    const sent = Date.now();
    const t0 = performance.now(); // monotonic, so the round trip is measured exactly
    const res = await fetch(TIME_URL, { cache: "no-store" });
    const { t } = (await res.json()) as { t: number };
    const rtt = performance.now() - t0;
    // Assume the server stamped the time halfway through the round trip.
    return { offset: t - (sent + rtt / 2), rtt };
  } catch {
    return null;
  }
}

/**
 * Ping several times and keep the fastest round trip: the less time a ping
 * spent on the network, the less room there is for error in its estimate.
 */
export async function syncClock(pings = 10): Promise<Sample | null> {
  let round: Sample | null = null;
  for (let i = 0; i < pings; i++) {
    const s = await ping();
    if (s && (!round || s.rtt < round.rtt)) round = s;
  }
  // Keep the previous estimate unless this round was at least as clean, but
  // let it age out so slow clock drift on the phone still gets corrected.
  if (round && (!best || round.rtt <= best.rtt * 1.5)) best = round;
  return best;
}
