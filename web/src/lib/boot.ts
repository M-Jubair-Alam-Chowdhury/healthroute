/**
 * Start-up checks for the loading screen (components/BootScreen.tsx).
 * Plain functions with no React, so they are easy to read and test.
 */

/** Resolves when the 3D body is drawn (or the 2D fallback is showing). Gives up after timeoutMs so the app never hangs. */
export function waitForBody(timeoutMs = 25000, isCancelled: () => boolean = () => false): Promise<"ready" | "timeout"> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (isCancelled()) return resolve("timeout");
      // <health-body-selector> keeps its state on the element: `loading` is true while the .glb model downloads,
      // `viewer` is set once WebGL works, `fallback` once it switched to the 2D drawing.
      const el = document.querySelector("health-body-selector") as any;
      if (el && el.loading === false && (el.viewer || el.fallback)) return resolve("ready");
      if (Date.now() - t0 > timeoutMs) return resolve("timeout");
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * Pings a service until it answers (any HTTP answer counts, even 404: it only has to be awake).
 * Free hosts put idle servers to sleep and the first request wakes them, which can take a minute,
 * so this retries every intervalMs and gives up after timeoutMs ("slow": the app opens anyway).
 */
export async function waitForService(
  url: string,
  { timeoutMs = 60000, intervalMs = 2500, isCancelled = () => false }: { timeoutMs?: number; intervalMs?: number; isCancelled?: () => boolean } = {}
): Promise<"up" | "slow"> {
  const t0 = Date.now();
  while (!isCancelled() && Date.now() - t0 < timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      // no-cors: we only care that something answered, not about reading the reply
      await fetch(url, { mode: "no-cors", signal: ctl.signal, cache: "no-store" });
      return "up";
    } catch {
      /* not reachable yet */
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return isCancelled() ? "up" : "slow";
}
