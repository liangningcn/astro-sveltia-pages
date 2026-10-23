// Cloudflare Pages Function for Sveltia CMS GitHub OAuth.
// 来源：reforteha 生产项目（functions/auth.js），逻辑保持一致。
// 一处偏离：生产 origin 改为 env.SITE_URL 优先（request.url 的 origin 在
// 自定义域 / *.pages.dev 预览域 / 本地 wrangler pages dev 下可能与 OAuth App
// 登记的 callback 不一致），缺失时 fallback 到动态 request origin。
// Deploy: copy this file to <project root>/functions/auth.js (or run
// `pnpm exec astro-sveltia-pages init`), then set GITHUB_CLIENT_ID,
// GITHUB_CLIENT_SECRET, ENVIRONMENT and SITE_URL in the Cloudflare Pages
// dashboard.

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    const clientId = env.GITHUB_CLIENT_ID;
    const clientSecret = env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return new Response(
            JSON.stringify({ error: "GitHub OAuth credentials not configured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }

    const siteUrl = env.SITE_URL?.trim();
    const origin = siteUrl || url.origin;

    const code = url.searchParams.get("code");

    if (!code) {
        // Step 1: Redirect to GitHub for authorization
        const redirectUri = encodeURIComponent(`${origin}/auth`);
        const scope = encodeURIComponent("repo,user");
        const state = encodeURIComponent(Math.random().toString(36).substring(7));
        const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
        return Response.redirect(githubAuthUrl, 302);
    }

    try {
        // Step 2: Exchange code for access token
        const redirectUri = `${origin}/auth`;

        const tokenResponse = await fetch(
            "https://github.com/login/oauth/access_token",
            {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code,
                    redirect_uri: redirectUri,
                }),
            },
        );

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            return new Response(
                JSON.stringify({
                    error: tokenData.error_description || tokenData.error,
                }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        const token = tokenData.access_token;

        // Step 3: Return HTML that handles the OAuth callback
        // Sveltia CMS expects message format: authorization:github:success:{"token":"..."}
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .success {
      color: #22c55e;
      font-size: 1.2rem;
      margin-bottom: 1rem;
    }
    .loading {
      color: #666;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">✓ 授权成功</div>
    <div class="loading">正在跳转到管理后台...</div>
  </div>
  <script>
    (function() {
      var token = '${token}';
      var origin = '${origin}';
      var content = JSON.stringify({token: token, provider: 'github'});

      if (window.opener && window.opener !== window) {
        try {
          window.opener.postMessage(
            'authorization:github:success:' + content,
            origin
          );
          window.opener.postMessage(
            'authorization:github:success:' + content,
            '*'
          );
          setTimeout(function() {
            window.close();
          }, 1000);
        } catch (e) {
          window.location.href = origin + '/admin/#access_token=' + encodeURIComponent(token);
        }
      } else {
        window.location.href = origin + '/admin/#access_token=' + encodeURIComponent(token);
      }
    })();
  </script>
</body>
</html>`;

        return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    } catch (error) {
        console.error("Auth error:", error);
        return new Response(JSON.stringify({ error: "Authentication failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}

export async function onRequestOptions(context) {
    const env = context?.env;
    const productionOrigin =
        env?.SITE_URL?.trim() || new URL(context.request.url).origin;
    const origin = env?.ENVIRONMENT === "production" ? productionOrigin : "*";
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        },
    });
}
