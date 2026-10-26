import { hmacSha256Hex, timingSafeEqual } from "./sha256.js";

/** Lifetime of an OAuth state value. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Signs a stateless CSRF state value.
 *
 * The state is `timestamp.hmac-sha256(timestamp, clientSecret)`: it carries
 * its own expiry, so no server-side session is needed. The client secret
 * doubles as the signing key, which means the state cannot be forged without
 * the same secret the token exchange uses.
 */
export function signState(secret: string, timestamp: number = Date.now()): string {
    const payload = String(timestamp);

    return `${payload}.${hmacSha256Hex(secret, payload)}`;
}

/**
 * Verifies a state value: the signature must match and the timestamp must be
 * within {@link STATE_TTL_MS}.
 */
export function verifyState(
    secret: string,
    state: string,
    now: number = Date.now(),
): boolean {
    const separator = state.indexOf(".");

    if (separator <= 0) {
        return false;
    }

    const payload = state.slice(0, separator);
    const signature = state.slice(separator + 1);
    const timestamp = Number(payload);

    if (!Number.isFinite(timestamp)) {
        return false;
    }

    if (Math.abs(now - timestamp) > STATE_TTL_MS) {
        return false;
    }

    return timingSafeEqual(signature, hmacSha256Hex(secret, payload));
}
