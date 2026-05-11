// Get diff (before/after) for one PR. Reviewer-gated.
import {
  json,
  verifyUser,
  installationToken,
  ghJson,
  fromBase64,
  repoCoords,
  assertReviewer,
} from "./_github.js"

export default async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: "invalid JSON body" }, 400)
  }
  const { userToken, prNumber } = body || {}
  if (!Number.isInteger(prNumber)) return json({ error: "bad prNumber" }, 400)

  let user
  try {
    user = await verifyUser(userToken)
  } catch (e) {
    return json({ error: e.message }, 401)
  }

  const { owner, repo } = repoCoords()
  let appToken
  try {
    appToken = await installationToken()
  } catch (e) {
    return json({ error: e.message }, 500)
  }

  try {
    await assertReviewer(appToken, user.login)
  } catch (e) {
    return json({ error: e.message }, e.status || 500)
  }

  // Fetch PR + files
  let pr, files
  try {
    pr = await ghJson(appToken, `/repos/${owner}/${repo}/pulls/${prNumber}`)
    files = await ghJson(
      appToken,
      `/repos/${owner}/${repo}/pulls/${prNumber}/files`,
    )
  } catch (e) {
    return json({ error: e.message }, 500)
  }

  // For each markdown file in the PR, fetch before/after content
  const out = []
  for (const f of files) {
    if (!f.filename.endsWith(".md")) continue
    let beforeContent = ""
    let afterContent = ""

    if (f.status !== "added") {
      try {
        const beforeRes = await ghJson(
          appToken,
          `/repos/${owner}/${repo}/contents/${f.filename.split("/").map(encodeURIComponent).join("/")}?ref=main`,
        )
        beforeContent = fromBase64(beforeRes.content)
      } catch {}
    }
    if (f.status !== "removed") {
      try {
        const afterRes = await ghJson(
          appToken,
          `/repos/${owner}/${repo}/contents/${f.filename.split("/").map(encodeURIComponent).join("/")}?ref=${pr.head.sha}`,
        )
        afterContent = fromBase64(afterRes.content)
      } catch {}
    }

    out.push({
      filename: f.filename,
      status: f.status,
      before: beforeContent,
      after: afterContent,
    })
  }

  return json({
    pr: {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      url: pr.html_url,
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
    },
    files: out,
  })
}

export const config = { path: "/api/get-edit" }
