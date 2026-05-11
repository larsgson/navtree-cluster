#!/usr/bin/env node
// Pre-build content fetch.
//
// If CONTENT_SOURCE is unset, this script is a no-op — the build uses the
// local `content/` folder (mode A: content lives in the client repo).
//
// If CONTENT_SOURCE is set, the build pulls `content/` from another GitHub
// repo and replaces the local folder before Astro reads it (mode B: client
// app serves a separate content repo).
//
// Env vars:
//   CONTENT_SOURCE         "owner/repo" or "owner/repo@ref" (default ref: main)
//   CONTENT_FETCH_TOKEN    optional; required for private content repos.
//                          a Personal Access Token, or an installation token
//                          minted out-of-band.

import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

const source = process.env.CONTENT_SOURCE
if (!source) {
  if (fs.existsSync("content")) {
    console.log(
      "[fetch-content] CONTENT_SOURCE unset — using local content/ folder.",
    )
    process.exit(0)
  }
  console.error(
    "[fetch-content] No local content/ folder, and CONTENT_SOURCE is unset.\n" +
      "  Either:\n" +
      "    - Set CONTENT_SOURCE=owner/repo[@ref] to fetch content from another repo (mode B), or\n" +
      "    - Commit a content/ folder to this repo (mode A).",
  )
  process.exit(1)
}

const m = /^([^/\s]+)\/([^@\s]+)(?:@(.+))?$/.exec(source.trim())
if (!m) {
  console.error(
    `[fetch-content] CONTENT_SOURCE must be "owner/repo" or "owner/repo@ref"; got: ${source}`,
  )
  process.exit(1)
}
const [, owner, repo, ref = "main"] = m

const token = process.env.CONTENT_FETCH_TOKEN || ""
const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`
const headers = {
  "User-Agent": "navtree-cluster-build",
  Accept: "application/vnd.github+json",
}
if (token) headers.Authorization = `Bearer ${token}`

console.log(`[fetch-content] Fetching ${owner}/${repo}@${ref} ...`)

const res = await fetch(url, { headers, redirect: "follow" })
if (!res.ok) {
  console.error(
    `[fetch-content] Fetch failed: ${res.status} ${res.statusText}\n` +
      `  URL: ${url}\n` +
      (token
        ? "  (a token was provided)"
        : "  (no token — set CONTENT_FETCH_TOKEN for private repos)"),
  )
  process.exit(1)
}

const tmpDir = ".content-tmp"
fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

const tarPath = path.join(tmpDir, "src.tar.gz")
fs.writeFileSync(tarPath, Buffer.from(await res.arrayBuffer()))

await new Promise((resolve, reject) => {
  const p = spawn(
    "tar",
    ["xzf", tarPath, "-C", tmpDir, "--strip-components=1"],
    { stdio: "inherit" },
  )
  p.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)),
  )
})

const fetchedContent = path.join(tmpDir, "content")
if (!fs.existsSync(fetchedContent)) {
  console.error(
    `[fetch-content] ${owner}/${repo}@${ref} has no "content/" folder.`,
  )
  process.exit(1)
}

fs.rmSync("content", { recursive: true, force: true })
fs.renameSync(fetchedContent, "content")
fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(
  `[fetch-content] OK: content/ now reflects ${owner}/${repo}@${ref}.`,
)
