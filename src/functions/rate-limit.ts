/** Rate limit configuration. */
export type RateLimitOptions = {
    /** Requests allowed per window, per client IP. */
    limit: number;
    /** Window length in milliseconds. */
    windowMs: number;
};

/** Default limit: 30 requests per minute per client IP. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { limit: 30, windowMs: 60 * 1000 };

/** Hard cap on distinct tracked clients per isolate. */
export const MAX_TRACKED_CLIENTS = 4096;

/**
 * Creates a per-isolate rate limiter.
 *
 * The counters live in the memory of the isolate that serves the request, so
 * the limit is best effort: it protects a single instance, not the whole
 * deployment. Every edge platform spreads traffic over many isolates.
 */
export type RateLimiter = {
    /**
     * Registers a hit for `key` and reports whether it stays within the
     * limit.
     */
    hit(key: string, now?: number): boolean;
    /** Number of tracked clients. */
    readonly size: number;
};

/**
 * Evicts the soonest-to-expire bucket while the map is over the cap.
 *
 * Without this bound an attacker that rotates the key every request (e.g. a
 * spoofed client IP) would grow the map without limit. Evicting the bucket
 * that expires first keeps memory bounded while least affecting active
 * clients.
 */
function enforceCap(
    hits: Map<string, { count: number; resetAt: number }>,
    now: number,
): void {
    if (hits.size <= MAX_TRACKED_CLIENTS) {
        return;
    }

    let oldestKey: string | null = null;
    let oldestReset = Number.POSITIVE_INFINITY;

    for (const [key, entry] of hits) {
        if (entry.resetAt < oldestReset) {
            oldestReset = entry.resetAt;
            oldestKey = key;
        }
    }

    if (oldestKey !== null) {
        hits.delete(oldestKey);
    }
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
    const hits = new Map<string, { count: number; resetAt: number }>();

    return {
        hit(key: string, now: number = Date.now()): boolean {
            const entry = hits.get(key);

            if (!entry || now >= entry.resetAt) {
                hits.set(key, { count: 1, resetAt: now + options.windowMs });
                enforceCap(hits, now);

                return true;
            }

            entry.count += 1;

            return entry.count <= options.limit;
        },
        get size(): number {
            return hits.size;
        },
    };
}
