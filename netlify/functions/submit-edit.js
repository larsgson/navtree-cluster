// Submit an edit or new page as a Pull Request.
// Body: { userToken, mode: "edit"|"create", parentPath: string[], slug, title, body }
import {
  json,
  verifyUser,
  installationToken,
  ghFetch,
  ghJson,
  repoCoords,
  toBase64,
  fromBase64,
  buildIndexMd,
  parseFrontmatter,
  isSafeSlug,
  isSafePathSegments,
} from "./_github.js"

export default async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405)

  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: "invalid JSON body" }, 400)
  }

  const { userToken, mode, parentPath, slug, title, body } = payload || {}
  if (!["edit", "create"].includes(mode)) return json({ error: "bad mode" }, 400)
  if (!isSafePathSegments(parentPath)) return json({ error: "bad parentPath" }, 400)
  if (!isSafeSlug(slug)) return json({ error: "bad slug" }, 400)
  if (typeof title !== "string" || title.trim().length === 0)
    return json({ error: "title required" }, 400)
  if (typeof body !== "string") return json({ error: "body must be a string" }, 400)

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

  const nodeSegments = mode === "edit" ? parentPath : [...parentPath, slug]
  const filePath = `content/${nodeSegments.join("/")}/_index.md`
  const newContent = buildIndexMd({ title, body })

  // --- 1. Get main HEAD SHA
  let mainSha
  try {
    const ref = await ghJson(appToken, `/repos/${owner}/${repo}/git/ref/heads/main`)
    mainSha = ref.object.sha
  } catch (e) {
    return json({ error: `cannot read main: ${e.message}` }, 500)
  }

  // --- 2. Decide what file changes to make
  const changes = []

  if (mode === "edit") {
    // Need current file SHA to overwrite
    try {
      const existing = await ghJson(
        appToken,
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}?ref=main`,
      )
      changes.push({
        path: filePath,
        content: newContent,
        sha: existing.sha,
      })
    } catch (e) {
      return json({ error: `cannot read current file: ${e.message}` }, 500)
    }
  } else {
    // create: new _index.md, plus optionally update parent's order
    changes.push({ path: filePath, content: newContent, sha: null })

    const parentPathStr =
      parentPath.length > 0 ? `content/${parentPath.join("/")}/_index.md` : `content/_index.md`
    try {
      const parent = await ghJson(
        appToken,
        `/repos/${owner}/${repo}/contents/${parentPathStr}?ref=main`,
      )
      const parentMd = fromBase64(parent.content)
      const { data, body: parentBody } = parseFrontmatter(parentMd)
      if (Array.isArray(data.order) && !data.order.includes(slug)) {
        const newOrder = [...data.order, slug]
        const updatedParent = buildIndexMd({
          title: data.title ?? parentPath[parentPath.length - 1] ?? "Home",
          body: parentBody,
          order: newOrder,
        })
        changes.push({
          path: parentPathStr,
          content: updatedParent,
          sha: parent.sha,
        })
      }
    } catch {
      // parent _index.md absent or unreadable — skip order update
    }
  }

  // --- 3. Create branch
  const branchName = `edit/${user.login}/${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`
  try {
    await ghJson(appToken, `/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: mainSha,
      }),
    })
  } catch (e) {
    return json({ error: `cannot create branch: ${e.message}` }, 500)
  }

  // --- 4. Commit each change on the branch
  const commitMsg =
    mode === "edit"
      ? `Edit ${title}\n\nCo-authored-by: ${user.login} <${user.id}+${user.login}@users.noreply.github.com>`
      : `Add ${title}\n\nCo-authored-by: ${user.login} <${user.id}+${user.login}@users.noreply.github.com>`

  for (const ch of changes) {
    const putBody = {
      message: commitMsg,
      content: toBase64(ch.content),
      branch: branchName,
    }
    if (ch.sha) putBody.sha = ch.sha
    try {
      await ghJson(
        appToken,
        `/repos/${owner}/${repo}/contents/${ch.path.split("/").map(encodeURIComponent).join("/")}`,
        { method: "PUT", body: JSON.stringify(putBody) },
      )
    } catch (e) {
      return json({ error: `commit failed on ${ch.path}: ${e.message}` }, 500)
    }
  }

  // --- 5. Open the PR
  const prTitle =
    mode === "edit" ? `Edit: ${title}` : `Add: ${title} (/${nodeSegments.join("/")})`
  const prBody =
    `Submitted by @${user.login} via the editor UI.\n\n` +
    `**Path:** \`/${nodeSegments.join("/")}\`\n` +
    `**Mode:** ${mode}\n\n` +
    `_This PR was created by the GitHub App on behalf of the contributor._`

  let pr
  try {
    pr = await ghJson(appToken, `/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: branchName,
        base: "main",
      }),
    })
  } catch (e) {
    return json({ error: `cannot open PR: ${e.message}` }, 500)
  }

  // --- 6. If user is trusted, enable auto-merge (best-effort)
  let autoMerge = false
  try {
    const trusted = await loadTrustedSet(appToken, owner, repo)
    if (trusted.has(user.login)) {
      await enableAutoMerge(appToken, pr.node_id)
      autoMerge = true
    }
  } catch (e) {
    console.warn("auto-merge step failed:", e.message)
  }

  return json({
    pr_number: pr.number,
    pr_url: pr.html_url,
    branch: branchName,
    auto_merge: autoMerge,
  })
}

export const config = { path: "/api/submit-edit" }

async function loadTrustedSet(appToken, owner, repo) {
  try {
    const data = await ghJson(
      appToken,
      `/repos/${owner}/${repo}/contents/data/trusted-contributors.json?ref=main`,
    )
    const content = JSON.parse(fromBase64(data.content))
    return new Set(content.trusted || [])
  } catch {
    return new Set()
  }
}

async function enableAutoMerge(appToken, prNodeId) {
  const query = `mutation($id: ID!) {
    enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) {
      pullRequest { number }
    }
  }`
  const r = await ghFetch(appToken, "https://api.github.com/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables: { id: prNodeId } }),
  })
  const data = await r.json()
  if (data.errors) {
    throw new Error(data.errors.map((e) => e.message).join("; "))
  }
}
