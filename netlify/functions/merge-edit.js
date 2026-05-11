// Merge a PR (squash). Reviewer-gated.
import {
  json,
  verifyUser,
  installationToken,
  ghJson,
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

  try {
    const result = await ghJson(
      appToken,
      `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      {
        method: "PUT",
        body: JSON.stringify({
          merge_method: "squash",
          commit_title: `Merge PR #${prNumber}`,
        }),
      },
    )
    return json({ merged: !!result.merged, sha: result.sha })
  } catch (e) {
    return json({ error: e.message, status: e.status }, e.status || 500)
  }
}

export const config = { path: "/api/merge-edit" }
