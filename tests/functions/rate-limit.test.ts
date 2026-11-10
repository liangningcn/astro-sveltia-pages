import { describe, expect, it } from "vitest";

import {
    createRateLimiter,
    DEFAULT_RATE_LIMIT,
    MAX_TRACKED_CLIENTS,
} from "../../src/functions/rate-limit.ts";

describe("createRateLimiter", () => {
    it("allows up to the limit and rejects the next request", () => {
        const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
        const now = 1000;

        expect(limiter.hit("ip", now)).toBe(true);
        expect(limiter.hit("ip", now)).toBe(true);
        expect(limiter.hit("ip", now)).toBe(false);
    });

    it("rejects within the window and resets exactly at the boundary", () => {
        const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

        expect(limiter.hit("ip", 0)).toBe(true);
        expect(limiter.hit("ip", 999)).toBe(false);
        // At now === resetAt the previous bucket has expired.
        expect(limiter.hit("ip", 1000)).toBe(true);
        expect(limiter.hit("ip", 1001)).toBe(false);
    });

    it("keeps different keys independent", () => {
        const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

        expect(limiter.hit("a", 0)).toBe(true);
        expect(limiter.hit("a", 0)).toBe(false);
        expect(limiter.hit("b", 0)).toBe(true);
    });

    it("shares one bucket for the unknown client IP", () => {
        const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

        expect(limiter.hit("unknown", 0)).toBe(true);
        expect(limiter.hit("unknown", 0)).toBe(false);
    });

    it("reuses an expired bucket, resetting the count and window", () => {
        const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

        expect(limiter.hit("ip", 0)).toBe(true);
        expect(limiter.hit("ip", 0)).toBe(false);
        // Past the window the bucket is treated as brand new.
        expect(limiter.hit("ip", 1000)).toBe(true);
    });

    it("caps tracked clients to bound memory under rotated keys", () => {
        const limiter = createRateLimiter({ limit: 1_000_000, windowMs: 1_000_000 });

        for (let i = 0; i < MAX_TRACKED_CLIENTS + 100; i += 1) {
            limiter.hit(`client-${i}`, 0);
        }

        expect(limiter.size).toBe(MAX_TRACKED_CLIENTS);
        // The limiter keeps working after evictions.
        expect(limiter.hit("fresh", 0)).toBe(true);
    });

    it("uses Date.now when no timestamp is supplied", () => {
        const limiter = createRateLimiter(DEFAULT_RATE_LIMIT);

        expect(limiter.hit("ip")).toBe(true);
    });

    it("keeps size bounded under constantly rotating fresh keys", () => {
        const limiter = createRateLimiter({ limit: 1, windowMs: 1_000_000 });

        let now = 0;
        for (let i = 0; i < MAX_TRACKED_CLIENTS + 500; i += 1) {
            limiter.hit(`client-${i}`, now);
            // Advance time so every new bucket stays far from expiry and the
            // cap is enforced purely by evicting the soonest-to-expire bucket.
            now += 1000;
        }

        expect(limiter.size).toBeLessThanOrEqual(MAX_TRACKED_CLIENTS);
    });

    it("reclaims expired buckets once the cap is exceeded", () => {
        const limiter = createRateLimiter({ limit: 1_000_000, windowMs: 1000 });

        // A single live bucket that expires far in the future.
        limiter.hit("live", 5000);

        // Fill the rest with already-expired buckets (resetAt in the past).
        for (let i = 0; i < MAX_TRACKED_CLIENTS - 1; i += 1) {
            limiter.hit(`expired-${i}`, 0);
        }

        // A brand-new hit at t=5000 triggers enforceCap while over the cap.
        limiter.hit("new", 5000);

        // FIFO drops from the front: the leading `live` bucket goes first (it
        // is the oldest), then every expired bucket is reclaimed in the same
        // pass, leaving only the just-inserted `new` bucket. Evicting a live
        // bucket resets its quota, which is acceptable for a best-effort
        // per-isolate limiter and is the cost of O(1) eviction.
        expect(limiter.size).toBeLessThanOrEqual(MAX_TRACKED_CLIENTS);
        expect(limiter.size).toBe(1);
        expect(limiter.hit("live", 5000)).toBe(true);
    });

    it("evicts the oldest bucket first once the cap is exceeded", () => {
        const limiter = createRateLimiter({ limit: 1, windowMs: 1_000_000 });

        expect(limiter.hit("oldest", 0)).toBe(true);
        expect(limiter.hit("newest", 0)).toBe(true);

        for (let i = 0; i < MAX_TRACKED_CLIENTS; i += 1) {
            limiter.hit(`client-${i}`, 0);
        }

        expect(limiter.size).toBe(MAX_TRACKED_CLIENTS);
        // The two earliest keys were dropped from the front of the FIFO.
        expect(limiter.hit("oldest", 0)).toBe(true);
        // A key inserted at the tail survived with its original count.
        expect(limiter.hit(`client-${MAX_TRACKED_CLIENTS - 1}`, 0)).toBe(false);
    });

    it("stays linear when an attacker rotates the client key", () => {
        const limiter = createRateLimiter({ limit: 1_000_000, windowMs: 60_000 });
        const startedAt = performance.now();

        for (let i = 0; i < 20_000; i += 1) {
            limiter.hit(`client-${i}`, i);
        }

        // The old O(n^2) eviction took >8s for 20k keys; the FIFO path takes
        // a few ms. 2s is deliberately generous to stay stable on slow CI.
        expect(performance.now() - startedAt).toBeLessThan(2_000);
        expect(limiter.size).toBeLessThanOrEqual(MAX_TRACKED_CLIENTS);
    });
});
