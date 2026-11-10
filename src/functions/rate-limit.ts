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
 * Bounds the map with amortised O(1) eviction.
 *
 * `Map` preserves insertion order, and with a monotonic clock the oldest
 * bucket is also the one expiring soonest. Dropping from the front therefore
 * reclaims expired buckets first and approximates the old "soonest-to-expire"
 * policy without scanning the whole map for every new key. Each key is visited
 * at most once between insertions, so a client rotating IPs cannot turn this
 * into O(n^2) work.
 */
function enforceCap(
    hits: Map<string, { count: number; resetAt: number }>,
    now: number,
): void {
    if (hits.size <= MAX_TRACKED_CLIENTS) {
        return;
    }

    for (const key of hits.keys()) {
        const entry = hits.get(key);
        const expired = entry !== undefined && now >= entry.resetAt;

        if (hits.size > MAX_TRACKED_CLIENTS || expired) {
            hits.delete(key);
        } else {
            break;
        }
    }
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
    const hits = new Map<string, { count: number; resetAt: number }>();

    return {
        hit(key: string, now: number = Date.now()): boolean {
            const entry = hits.get(key);

            if (!entry || now >= entry.resetAt) {
                // Re-insert so a refreshed bucket moves to the tail of the FIFO
                // instead of keeping its original (now stale) position.
                hits.delete(key);
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
