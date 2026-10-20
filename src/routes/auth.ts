import type { APIRoute } from "astro";

export const prerender = false;

const STATE_COOKIE_NAME = "sveltia_oauth_state";
const STATE_MAX_AGE_SECONDS = 600;
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const CALLBACK_PATH = "/api/callback";

function readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Start the GitHub OAuth authorization code flow.
 *
 * Sveltia CMS opens this endpoint in a popup, so only a redirect is needed. The
 * `state` value is kept in an HttpOnly cookie and compared in the callback.
 */
export const GET: APIRoute = ({ url, cookies }) => {
    const clientId = readString(import.meta.env.GITHUB_CLIENT_ID);

    if (!clientId) {
        return new Response(
            "Missing GITHUB_CLIENT_ID. Add it to the environment Astro builds with.",
            {
                status: 500,
                headers: {
                    "content-type": "text/plain; charset=utf-8",
                    "cache-control": "no-store",
                },
            },
        );
    }

    const state = crypto.randomUUID();
    const redirectUri = new URL(CALLBACK_PATH, url.origin).toString();

    cookies.set(STATE_COOKIE_NAME, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: url.protocol === "https:",
        path: "/",
        maxAge: STATE_MAX_AGE_SECONDS,
    });

    const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);

    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", "repo");
    authorizeUrl.searchParams.set("state", state);

    return new Response(null, {
        status: 302,
        headers: {
            location: authorizeUrl.toString(),
            "cache-control": "no-store",
        },
    });
};
