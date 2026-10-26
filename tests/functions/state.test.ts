import { describe, expect, it } from "vitest";

import { hmacSha256Hex } from "../../src/functions/sha256.ts";
import { signState, STATE_TTL_MS, verifyState } from "../../src/functions/state.ts";

describe("signState / verifyState", () => {
    const secret = "client-secret";

    it("signs the timestamp with the client secret", () => {
        const state = signState(secret, 1_700_000_000_000);
        const [timestamp, signature] = state.split(".");

        expect(timestamp).toBe("1700000000000");
        expect(signature).toBe(hmacSha256Hex(secret, "1700000000000"));
    });

    it("accepts a fresh state", () => {
        const now = 1_700_000_000_000;
        const state = signState(secret, now);

        expect(verifyState(secret, state, now)).toBe(true);
    });

    it("accepts a state that is almost expired", () => {
        const now = 1_700_000_000_000;
        const state = signState(secret, now - STATE_TTL_MS + 1000);

        expect(verifyState(secret, state, now)).toBe(true);
    });

    it("rejects an expired state", () => {
        const now = 1_700_000_000_000;
        const state = signState(secret, now - STATE_TTL_MS - 1000);

        expect(verifyState(secret, state, now)).toBe(false);
    });

    it("rejects a state signed with another secret", () => {
        const now = 1_700_000_000_000;
        const state = signState("another-secret", now);

        expect(verifyState(secret, state, now)).toBe(false);
    });

    it("rejects a tampered signature", () => {
        const now = 1_700_000_000_000;
        const state = signState(secret, now);
        const [, signature] = state.split(".");
        const flipped = signature.startsWith("a") ? "b" : "a";

        expect(
            verifyState(secret, `1700000000000.${flipped}${signature.slice(1)}`, now),
        ).toBe(false);
    });

    it("rejects a tampered timestamp", () => {
        const now = 1_700_000_000_000;
        const state = signState(secret, now);
        const [, signature] = state.split(".");

        expect(verifyState(secret, `1700000000001.${signature}`, now)).toBe(false);
    });

    it("rejects malformed states", () => {
        expect(verifyState(secret, "", 1_700_000_000_000)).toBe(false);
        expect(verifyState(secret, "no-separator", 1_700_000_000_000)).toBe(false);
        expect(verifyState(secret, ".signature", 1_700_000_000_000)).toBe(false);
        expect(verifyState(secret, "not-a-number.deadbeef", 1_700_000_000_000)).toBe(
            false,
        );
    });
});
