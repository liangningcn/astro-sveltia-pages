import { describe, expect, it } from "vitest";

import * as stable from "../../src/functions/index.ts";
import * as internal from "../../src/functions/internal.ts";

describe("public export surface", () => {
    it("exposes only the stable API from the top-level functions entry", () => {
        expect(typeof stable.createAuthHandler).toBe("function");
        expect(typeof stable.signState).toBe("function");
        expect(typeof stable.verifyState).toBe("function");
        expect(typeof stable.STATE_TTL_MS).toBe("number");
    });

    it("does not leak internal helpers from the top-level functions entry", () => {
        const leaked = [
            "hmacSha256Hex",
            "timingSafeEqual",
            "autoAdapter",
            "detectAdapter",
            "createRateLimiter",
            "readEnvValue",
            "cloudflareAdapter",
            "edgeoneAdapter",
            "normalizeContext",
        ];

        for (const name of leaked) {
            expect(name in stable).toBe(false);
        }
    });

    it("keeps the internal helpers available from the internal entry", () => {
        expect(typeof internal.hmacSha256Hex).toBe("function");
        expect(typeof internal.timingSafeEqual).toBe("function");
        expect(typeof internal.autoAdapter).toBe("object");
        expect(typeof internal.createRateLimiter).toBe("function");
        expect(typeof internal.cloudflareAdapter).toBe("object");
        expect(typeof internal.edgeoneAdapter).toBe("object");
        expect(typeof internal.normalizeContext).toBe("function");
    });
});
