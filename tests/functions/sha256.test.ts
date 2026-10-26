import { describe, expect, it } from "vitest";

import { hmacSha256Hex, sha256 } from "../../src/functions/sha256.ts";

describe("sha256 / hmacSha256Hex", () => {
    it("computes the SHA-256 digest of the abc input", () => {
        const digest = sha256(new TextEncoder().encode("abc"));
        const hex = Array.from(digest)
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");

        expect(hex).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
    });

    it("matches the RFC 4231 test vector with a short key", () => {
        expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        );
    });

    it("hashes keys longer than the block size", () => {
        const key = "k".repeat(100);

        expect(
            hmacSha256Hex(
                key,
                "Test Using Larger Than Block-Size Key - Hash Key First",
            ),
        ).toBe("2bc51c04a41032b5f44910acdb471c67a7b1de64e91089e052761fe59a9dac4b");
    });
});
