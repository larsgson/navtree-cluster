// Exchange GitHub OAuth code for an access token.
// Env: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (from the GitHub App's OAuth section)

const getEnv = (key) =>
  typeof Netlify !== "undefined" && Netlify.env
    ? Netlify.env.get(key)
    : process.env[key]

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

export default async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405)

  let code
  try {
    ;({ code } = await request.json())
  } catch {
    return json({ error: "invalid request body" }, 400)
  }

  if (!code) return json({ error: "missing code" }, 400)

  const clientId = getEnv("GITHUB_CLIENT_ID")
  const clientSecret = getEnv("GITHUB_CLIENT_SECRET")
  if (!clientId || !clientSecret) {
    return json({ error: "GitHub OAuth not configured" }, 500)
  }

  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  })
  const data = await r.json()
  if (data.error) {
    return json({ error: data.error_description || data.error }, 400)
  }
  return json({ access_token: data.access_token, scope: data.scope })
}

export const config = { path: "/api/github-auth" }
