// Shared helpers for GitHub App + user identity + repo operations.
import { createAppAuth } from "@octokit/auth-app"

export const getEnv = (key) =>
  typeof Netlify !== "undefined" && Netlify.env
    ? Netlify.env.get(key)
    : process.env[key]

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

export function repoCoords() {
  // Coordinates of the *content* repo (where _index.md files live, where
  // PRs are opened, where trusted/reviewers JSON files are read). In the
  // one-repo deployment (mode A) this is the same repo as the client app.
  // In the multi-site deployment (mode B) it is a separate content repo
  // per site, while the client app remains a single shared codebase.
  return {
    owner: getEnv("CONTENT_REPO_OWNER"),
    repo: getEnv("CONTENT_REPO_NAME"),
  }
}

// Verify a user's OAuth token by calling /user. Returns { login, id, avatar_url }
// or throws.
export async function verifyUser(token) {
  if (!token) throw new Error("missing user token")
  const r = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  })
  if (!r.ok) throw new Error(`invalid user token (${r.status})`)
  return r.json()
}

let cachedInstallationToken = null
let cachedExpires = 0

export async function installationToken() {
  if (cachedInstallationToken && Date.now() < cachedExpires - 60_000) {
    return cachedInstallationToken
  }
  const appId = getEnv("GITHUB_APP_ID")
  const privateKey = (getEnv("GITHUB_APP_PRIVATE_KEY") || "").replace(/\\n/g, "\n")
  const installationId = getEnv("GITHUB_APP_INSTALLATION_ID")
  if (!appId || !privateKey || !installationId) {
    throw new Error("GitHub App env vars not configured")
  }
  const auth = createAppAuth({ appId, privateKey, installationId })
  const { token, expiresAt } = await auth({ type: "installation" })
  cachedInstallationToken = token
  cachedExpires = new Date(expiresAt).getTime()
  return token
}

export async function ghFetch(token, pathOrUrl, init = {}) {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `https://api.github.com${pathOrUrl}`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(init.headers || {}),
  }
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json"
  }
  return fetch(url, { ...init, headers })
}

export async function ghJson(token, pathOrUrl, init) {
  const r = await ghFetch(token, pathOrUrl, init)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.message || `GitHub API ${r.status}`
    throw Object.assign(new Error(msg), { status: r.status, body: data })
  }
  return data
}

// Base64 helpers
const enc = new TextEncoder()
export function toBase64(s) {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf-8").toString("base64")
  const bytes = enc.encode(s)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
export function fromBase64(b64) {
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf-8")
  const bin = atob(b64.replace(/\n/g, ""))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function buildIndexMd({ title, body, order }) {
  const fm = ["---", `title: ${yamlString(title)}`]
  if (Array.isArray(order) && order.length > 0) {
    fm.push(`order: [${order.map(yamlString).join(", ")}]`)
  }
  fm.push("---", "", body.replace(/\r\n/g, "\n").trimEnd(), "")
  return fm.join("\n")
}

function yamlString(s) {
  // Quote when contains special chars; otherwise leave bare.
  if (/^[A-Za-z0-9_\-\. ]+$/.test(s)) return s
  return JSON.stringify(s)
}

export function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md)
  if (!m) return { data: {}, body: md }
  const data = {}
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, k, v] = kv
    if (v.startsWith("[")) {
      try {
        data[k] = JSON.parse(v.replace(/'/g, '"'))
      } catch {
        data[k] = v
      }
    } else if (v.startsWith('"')) {
      try {
        data[k] = JSON.parse(v)
      } catch {
        data[k] = v
      }
    } else {
      data[k] = v
    }
  }
  return { data, body: m[2] }
}

export function isSafeSlug(s) {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s) && s.length <= 80
}

export function isSafePathSegments(segs) {
  if (!Array.isArray(segs)) return false
  return segs.every((s) => isSafeSlug(s))
}
