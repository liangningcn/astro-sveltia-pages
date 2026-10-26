/** Rate limit configuration. */
export type RateLimitOptions = {
    /** Requests allowed per window, per client IP. */
    limit: number;
    /** Window length in milliseconds. */
    windowMs: number;
};

/** Default limit: 30 requests per minute per client IP. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { limit: 30, windowMs: 60 * 1000 };

/** In-memory rate limiter scoped to a single isolate. */
export type RateLimiter = {
    /**
     * Registers a hit for `key` and reports whether it stays within the
     * limit.
     */
    hit(key: string, now?: number): boolean;
    /** Number of tracked clients. */
    readonly size: number;
};

const MAX_TRACKED_CLIENTS = 4096;

/**
 * Creates a per-isolate rate limiter.
 *
 * The counters live in the memory of the isolate that serves the request, so
 * the limit is best effort: it protects a single instance, not the whole
 * deployment. Every edge platform spreads traffic over many isolates.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
    const hits = new Map<string, { count: number; resetAt: number }>();

    function prune(now: number): void {
        if (hits.size <= MAX_TRACKED_CLIENTS) {
            return;
        }

        for (const [key, entry] of hits) {
            if (now >= entry.resetAt) {
                hits.delete(key);
            }
        }
    }

    return {
        hit(key: string, now: number = Date.now()): boolean {
            const entry = hits.get(key);

            if (!entry || now >= entry.resetAt) {
                hits.set(key, { count: 1, resetAt: now + options.windowMs });
                prune(now);

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
