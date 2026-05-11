# First-time test setup — separate content repo (mode B)

This walkthrough takes you from the current local checkout to a working
deployment with the content living in **its own GitHub repo**, edited
through a Netlify-hosted instance of this client app.

You will create:

- **Content repo** on GitHub — holds `content/` + `data/`. Public is fine
  for testing.
- **Client repo** on GitHub — this codebase. Public or private.
- **GitHub App** — single App used for both user identity (OAuth) and
  writing PRs to the content repo.
- **Netlify site** — built from the client repo, configured via env vars
  to point at the content repo.

The whole thing should take ~20 minutes.

> Note on naming. The walkthrough uses placeholders `OWNER` (your GitHub
> account), `CONTENT_REPO` (e.g. `demo-content`) and `CLIENT_REPO` (e.g.
> `nav-cluster-web` or keep `navtree-cluster`). Replace as you go.

---

## 1. Create the content repo and push initial content

The content repo just needs `content/` and `data/` at its root.

```bash
# From this client checkout:
cd ~/dev/bw/navtree-cluster

# Stage the content repo in a sibling folder
mkdir -p ../demo-content
cp -R content ../demo-content/
cp -R data ../demo-content/

cd ../demo-content
git init -b main
git add .
git commit -m "Initial content"
```

Now create an empty repo on github.com (don't initialise it with a README —
we already have a commit). Then:

```bash
git remote add origin git@github.com:OWNER/CONTENT_REPO.git
git push -u origin main
```

The repo's structure should look like:

```
CONTENT_REPO/
├── content/
│   ├── _index.md
│   ├── introduction/
│   │   └── _index.md
│   └── ...
└── data/
    ├── trusted-contributors.json
    └── reviewers.json
```

**Edit `data/reviewers.json` in the content repo to include your GitHub
login** — otherwise `/review` will refuse you. The functions read this
file from the content repo via the GitHub API, so this is the only place
the list needs to exist.

```json
{ "reviewers": ["YOUR_GITHUB_LOGIN"] }
```

Optionally add yourself to `trusted-contributors.json` if you want your own
edits to auto-merge.

---

## 2. Push the client repo to GitHub

```bash
cd ~/dev/bw/navtree-cluster

# Optional: delete the local content/ and data/ before committing.
# They aren't needed in the client repo in mode B; the build will
# fetch them from the content repo. They're harmless if you keep
# them (the build replaces them) — but committing them duplicates
# state. Recommendation: delete and ignore.
rm -rf content data
echo -e "/content/\n/data/" >> .gitignore

git init -b main
git add .
git commit -m "Initial CMS client"
```

Create the client repo on github.com (again, no README), then:

```bash
git remote add origin git@github.com:OWNER/CLIENT_REPO.git
git push -u origin main
```

---

## 3. Create the GitHub App

On github.com: **Settings → Developer settings → GitHub Apps → New GitHub
App**.

| Field | Value |
|---|---|
| GitHub App name | something unique (e.g. `nav-cluster-cms-demo`) |
| Homepage URL | the placeholder Netlify URL you'll get in step 4. For now, anything works (you'll come back to it). |
| Callback URL | `https://YOUR-SITE.netlify.app/auth/callback` (placeholder; updated after step 4) |
| Request user authorization (OAuth) during installation | **checked** |
| Webhook | uncheck (active) — not needed |
| Repository permissions | **Contents: Read and write**, **Pull requests: Read and write**, **Metadata: Read (auto)** |
| Where can this GitHub App be installed? | "Only on this account" |

After creating:

1. **Note the App ID** (top of the App settings page).
2. **Generate a private key** (bottom of the page). Download the `.pem`.
3. Under "OAuth credentials": **note the Client ID** and **generate a
   Client secret**.

Install it on the content repo:

1. App settings → **Install App** → pick your account → choose
   "Only select repositories" → pick `OWNER/CONTENT_REPO`.
2. After install, the URL ends in `/installations/NNN` — **note the
   installation ID** (`NNN`).

---

## 4. Create the Netlify site

1. Netlify dashboard → **Add new site → Import an existing project** →
   GitHub → pick `OWNER/CLIENT_REPO`.
2. Build settings:
   - Build command: `pnpm build` (default from `netlify.toml`)
   - Publish directory: `dist`
3. Don't deploy yet — finish env vars first.

### Configure environment variables

**Site configuration → Environment variables → Add a variable**. All of
these are required for mode B:

| Name | Value |
|---|---|
| `GITHUB_CLIENT_ID` | from the App's OAuth credentials |
| `GITHUB_CLIENT_SECRET` | from the App's OAuth credentials |
| `PUBLIC_GITHUB_CLIENT_ID` | same as `GITHUB_CLIENT_ID` (Astro inlines `PUBLIC_*` into the client bundle) |
| `GITHUB_APP_ID` | the numeric App ID |
| `GITHUB_APP_PRIVATE_KEY` | the full `.pem` file contents, including `-----BEGIN/END-----` lines. Paste as-is; Netlify preserves newlines. |
| `GITHUB_APP_INSTALLATION_ID` | the numeric installation ID |
| `CONTENT_REPO_OWNER` | `OWNER` |
| `CONTENT_REPO_NAME` | `CONTENT_REPO` |
| `CONTENT_SOURCE` | `OWNER/CONTENT_REPO` (the build will fetch from this repo) |
| `CONTENT_FETCH_TOKEN` | only needed if the content repo is **private**. Easiest source: a fine-grained PAT with `contents:read` on the content repo. |

### Trigger the first deploy

Now click **Deploy site**. The build log should show:

```
[fetch-content] Fetching OWNER/CONTENT_REPO@main ...
[fetch-content] OK: content/ now reflects OWNER/CONTENT_REPO@main.
...
[build] 26 page(s) built
```

Once deployed, you'll have a URL like `https://eager-feynman-12abc.netlify.app`.

---

## 5. Fix up the callback URL

Go back to the GitHub App settings:

- **Callback URL**: set to `https://<your-netlify-url>/auth/callback`.
- **Homepage URL**: optionally set to the same domain root.

(You can add a second callback URL for `http://localhost:8888/auth/callback`
later if you want to run `netlify dev` locally.)

---

## 6. Smoke test

1. Open the deployed site. You should see the navtree with the seed
   content from the content repo, the sidebar, breadcrumbs, prev/next.
2. Click **Log in with GitHub** in the header.
   - GitHub redirects you to the App's authorisation page.
   - Approve.
   - You land back on the original page; your avatar appears in the
     header alongside **Edit** / **+ Add page** / **Review**.
3. Navigate to a page, click **Edit**.
4. Change a word in the body, click **Submit edit as PR**.
5. The confirmation modal links you to the new PR on github.com.
   Open it — you should see a one-file diff under `content/.../`,
   with you as co-author.
6. Click **Review** in the header.
   - You should see your own PR listed (because your login is in
     `data/reviewers.json`).
   - Click **Open** — you'll see the before/after rendered side-by-side.
   - Click **Merge** — the PR closes, Netlify rebuilds within ~30s,
     and your change is live.

If you added yourself to `trusted-contributors.json` in the content repo,
new PRs you submit will auto-merge as soon as the Netlify check goes
green (i.e. as soon as the build for that PR's commit succeeds against
the deploy preview). You'll see `auto_merge: true` in the submit response.

---

## Troubleshooting

**"GitHub OAuth not configured" on login.**
The function can't see `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
Double-check they're set in Netlify and redeploy (env var changes don't
hot-reload running functions).

**"GitHub App env vars not configured" on submit.**
Same issue with `GITHUB_APP_*` vars. The private key in particular must
include the full `-----BEGIN RSA PRIVATE KEY-----` and
`-----END RSA PRIVATE KEY-----` lines.

**"not a reviewer" on /review.**
Your login isn't in the content repo's `data/reviewers.json`. Edit the
file in the content repo (via github.com) and refresh; no rebuild
required, since the function reads it from the API live.

**Build fails on `[fetch-content] Fetch failed: 404`.**
`CONTENT_SOURCE` points at a repo or ref that doesn't exist (or is
private without `CONTENT_FETCH_TOKEN`).

**PR opens but auto-merge doesn't engage for trusted users.**
You probably haven't enabled "Allow auto-merge" in the content repo's
**Settings → General**. Also: auto-merge will only fire once at least
one required status check passes; if branch protection isn't configured,
GitHub waits forever. Either add a required check (Netlify's PR build
counts) or merge manually.

**"state mismatch" on the OAuth callback.**
You opened the callback URL in a different browser session than the one
that started the login. Clear `gh-oauth-state` from sessionStorage and
retry.

---

## What changes when you go from this test to "real"

- Add a custom domain to Netlify; update the GitHub App's callback URL to match.
- Promote `data/reviewers.json` and `data/trusted-contributors.json`
  thoughtfully (each addition is a PR to the content repo).
- Enable branch protection + auto-merge in the content repo.

To run a **second** site off the same client codebase: create a second
content repo, install the GitHub App on it, create a second Netlify site
from the **same** client repo, give it its own `CONTENT_SOURCE`,
`CONTENT_REPO_*`, and `GITHUB_APP_INSTALLATION_ID` env vars (the App ID,
client ID/secret, and private key can be reused — the installation ID is
the per-repo bit). No code change needed.
