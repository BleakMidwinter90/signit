/**
 * Object URLs that are made once and cleaned up.
 *
 * `URL.createObjectURL(new Blob(...))` written inline in a component looks
 * harmless and leaks steadily: React re-renders on every state change, so
 * dragging a signature across a page — which fires on every mouse move — mints
 * a new URL each time, and each one pins its blob in memory until revoked.
 * Nothing visibly breaks; the tab just grows.
 */

const cache = new WeakMap<ArrayBuffer, string>();

/** A stable URL for these bytes, created at most once. */
export function urlFor(bytes: ArrayBuffer, type = 'image/png'): string {
  const existing = cache.get(bytes);
  if (existing) return existing;

  const url = URL.createObjectURL(new Blob([bytes], { type }));
  cache.set(bytes, url);
  return url;
}

/**
 * Release a URL made by `urlFor`.
 *
 * Not automatic: a WeakMap can tell when the bytes are collected but cannot run
 * anything at that moment, so releasing is the caller's job when it knows the
 * image is gone for good.
 */
export function release(bytes: ArrayBuffer): void {
  const existing = cache.get(bytes);
  if (!existing) return;
  URL.revokeObjectURL(existing);
  cache.delete(bytes);
}
