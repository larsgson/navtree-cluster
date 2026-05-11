// List open edit PRs. Reviewer-gated.
import {
  json,
  verifyUser,
  installationToken,
  ghJson,
  fromBase64,
  repoCoords,
} from "./_github.js"

export default async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405)

  let userToken
  try {
    ;({ userToken } = await request.json())
  } catch {
    return json({ error: "invalid JSON body" }, 400)
  }

  let user
  try {
    user = await verifyUser(userToken)
  } catch (e) {
    return json({ error: e.message }, 401)
  }

  const { owner, repo } = repoCoords()
  if (!owner || !repo) return json({ error: "repo not configured" }, 500)

  let appToken
  try {
    appToken = await installationToken()
  } catch (e) {
    return json({ error: e.message }, 500)
  }

  // Reviewer check
  try {
    const r = await ghJson(
      appToken,
      `/repos/${owner}/${repo}/contents/data/reviewers.json?ref=main`,
    )
    const reviewers = JSON.parse(fromBase64(r.content)).reviewers || []
    if (!reviewers.includes(user.login)) {
      return json({ error: "not a reviewer" }, 403)
    }
  } catch (e) {
    return json({ error: `reviewer list unavailable: ${e.message}` }, 500)
  }

  // List PRs
  try {
    const prs = await ghJson(
      appToken,
      `/repos/${owner}/${repo}/pulls?state=open&per_page=50`,
    )
    const filtered = prs
      .filter((p) => p.head?.ref?.startsWith("edit/"))
      .map((p) => ({
        number: p.number,
        title: p.title,
        body: p.body,
        url: p.html_url,
        head_ref: p.head.ref,
        head_sha: p.head.sha,
        created_at: p.created_at,
        updated_at: p.updated_at,
        author_login: extractAuthor(p.body) || p.user?.login,
      }))
    return json({ edits: filtered, viewer: user.login })
  } catch (e) {
    return json({ error: e.message }, 500)
  }
}

function extractAuthor(prBody) {
  if (!prBody) return null
  const m = /Submitted by @([\w-]+)/.exec(prBody)
  return m ? m[1] : null
}

export const config = { path: "/api/list-edits" }
