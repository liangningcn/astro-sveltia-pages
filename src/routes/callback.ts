import type { APIRoute } from "astro";

export const prerender = false;

const STATE_COOKIE_NAME = "sveltia_oauth_state";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const CALLBACK_PATH = "/api/callback";
const ADMIN_REDIRECT_PATH = "/admin/";

type TokenResponse = {
    access_token?: string;
    error?: string;
    error_description?: string;
};

function readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
}

function textResponse(message: string, status: number): Response {
    return new Response(message, {
        status,
        headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
        },
    });
}

/**
 * Finish the GitHub OAuth flow: verify `state` against the HttpOnly cookie,
 * exchange `code` for an access token and redirect back to the admin UI.
 */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
    const clientId = readString(import.meta.env.GITHUB_CLIENT_ID);
    const clientSecret = readString(import.meta.env.GITHUB_CLIENT_SECRET);

    if (!clientId || !clientSecret) {
        return textResponse(
            "Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET. Add both to the " +
                "environment Astro builds with.",
            500,
        );
    }

    const error = url.searchParams.get("error");

    if (error) {
        const description =
            url.searchParams.get("error_description") ??
            "GitHub denied the authorization.";

        return textResponse(`OAuth error (${error}): ${description}`, 400);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = cookies.get(STATE_COOKIE_NAME)?.value;

    cookies.delete(STATE_COOKIE_NAME, { path: "/" });

    if (!code || !state || !expectedState || state !== expectedState) {
        return textResponse(
            "Invalid OAuth state. Start the sign-in flow again from the CMS.",
            400,
        );
    }

    const redirectUri = new URL(CALLBACK_PATH, url.origin).toString();

    try {
        const response = await fetch(TOKEN_ENDPOINT, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }),
        });
        const payload = (await response.json()) as TokenResponse;

        if (!response.ok || !payload.access_token) {
            const reason =
                payload.error_description ?? payload.error ?? `HTTP ${response.status}`;

            return textResponse(`GitHub token exchange failed: ${reason}`, 502);
        }

        const token = encodeURIComponent(payload.access_token);

        return redirect(`${ADMIN_REDIRECT_PATH}?token=${token}&provider=github`);
    } catch (cause) {
        const reason = cause instanceof Error ? cause.message : "network error";

        return textResponse(`GitHub token exchange failed: ${reason}`, 502);
    }
};
