# Navtree CMS — Architecture & Implementation Plan

A small CMS-style site built on Astro + React where readers can browse a
hierarchical content tree and contributors with a GitHub account can edit any
page. All edits flow through GitHub Pull Requests; a small editor dashboard
inside the same app gives reviewers a fast preview + one-click merge UI.

This document is the canonical reference for the project. It captures the
decisions made before implementation, including why each was chosen, so the
implementation can begin from this document alone.

---

## Table of contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Inspiration: what we keep from the two examples](#2-inspiration-what-we-keep-from-the-two-examples)
3. [High-level architecture](#3-high-level-architecture)
4. [Content storage](#4-content-storage)
5. [Tree loader and routing](#5-tree-loader-and-routing)
6. [Navigation UI](#6-navigation-ui)
7. [GitHub OAuth — full flow](#7-github-oauth--full-flow)
8. [Editing — submitting a change](#8-editing--submitting-a-change)
9. [Trust tiers and auto-merge](#9-trust-tiers-and-auto-merge)
10. [Editor dashboard (/review)](#10-editor-dashboard-review)
11. [GitHub App — setup](#11-github-app--setup)
12. [Environment variables](#12-environment-variables)
13. [File layout to be created](#13-file-layout-to-be-created)
14. [Implementation order](#14-implementation-order)
15. [Out of scope (v1)](#15-out-of-scope-v1)
16. [Open questions](#16-open-questions)
17. [Multi-site configuration](#17-multi-site-configuration)

---

## 1. Goals and non-goals

### Goals
- A hierarchical, navigable content tree of arbitrary depth. The user always
  knows where they are in the tree (active highlighting, breadcrumbs, prev/next).
- Anyone with a GitHub account can propose an edit, including adding a new
  child page.
- Edits flow through Pull Requests; nothing reaches the live site without
  passing through review.
- A subset of trusted contributors can have their edits auto-merge once CI
  passes (low-friction path for known editors).
- Reviewers do their work inside the same app at `/review`: side-by-side
  rendered preview of the proposed page, one-click approve and merge.
- Static-first deployment on Netlify. No always-on backend; Netlify Functions
  handle the few server-side actions.

### Non-goals (v1)
- Live in-place editing of the production site (edits always go via PR).
- Image upload through the UI (markdown can reference images that already
  exist in `public/`; image upload is a v2 feature).
- WYSIWYG editor. v1 uses a textarea with live markdown preview; richer
  editors (e.g., TipTap, Lexical) can drop in later behind the same submit
  flow.
- Conflict resolution beyond the normal "stale base branch" behaviour GitHub
  already gives you in a PR.
- Renaming or moving nodes through the UI (do those by editing the repo
  directly for now — moving folders is a perfectly fine PR by hand).
- Multi-tenant content (one site = one content tree).

---

## 2. Inspiration: what we keep from the two examples

This repo currently contains two reference apps under `example/`. Each is
strong in a different area; this CMS combines them.

### From `example/iahc-app/` (most of the inspiration)
- **Hierarchical tree + sidebar with active highlighting and auto-expand
  current branch.** See `src/components/Sidebar.jsx`. Generalised here from
  the existing 2-level (chapter / section) limit to arbitrary depth.
- **Breadcrumbs in the page header** (currently in
  `src/pages/[lang]/chapter/[chapter]/index.astro:82-86`).
- **Prev/next arrow navigation** between sibling nodes
  (`src/components/SectionNavArrows.astro`).
- **GitHub OAuth via a Netlify Function** for the
  `code` → `access_token` exchange. See
  `netlify/functions/github-auth.js` and `src/pages/auth/callback.astro`.
  We reuse this exact pattern (see [§7](#7-github-oauth--full-flow)).
- **Edit-mode entrypoint pattern**: edit UI mounts on `?edit=true` or if a
  token is already present in sessionStorage
  (`src/pages/[lang]/chapter/[chapter]/index.astro:155-178`).
- **State-parameter CSRF protection** in the OAuth callback
  (`src/pages/auth/callback.astro:40-45`).

### From the current root app (`qombi-book-reader`)
- **Tailwind CSS** for styling (the iahc-app uses bespoke CSS files).
- **Astro 5.7** baseline.
- **TypeScript-first** code, including the data and lib layers.
- Light, focused dependency set.

### What we deliberately drop
- iahc-app's flat `NN_MM.json` file naming for tree structure. It caps at two
  levels (chapter / section) and encodes hierarchy in filenames.
  Replaced with nested folders (see [§4](#4-content-storage)).
- iahc-app's `image-overrides.json` editing model. It only edits one specific
  JSON file via direct GitHub commits from the browser using the user's OAuth
  token, and it commits straight to `main`. Useful as a reference for the
  OAuth flow only; the edit mechanism itself is replaced by the
  Netlify-Function-driven PR flow (see [§8](#8-editing--submitting-a-change)).
- The root app's `[book]` routing and audio store. Not needed for a CMS.
- The root app's bespoke `book-loader` / `markdown-parser` / `image-utils`.
  Replaced by a single tree loader plus standard markdown rendering.
- iahc-app's i18n / multi-language structure. v1 is single-language; a
  language axis can be added later as an outer folder level.

---

## 3. High-level architecture

```
                ┌──────────────────────────────────────────────┐
                │              Static Astro Site               │
                │  built from content/ tree at build time  │
                │                                              │
                │   /              → tree root page            │
                │   /a/b/c         → any node, depth arbitrary │
                │   /edit/a/b/c    → editor UI for a node      │
                │   /review        → editor dashboard          │
                │   /auth/callback → OAuth callback page       │
                └──────────────────────────────────────────────┘
                              │              ▲
                              │              │
                              ▼              │
                   ┌─────────────────────────────────┐
                   │      Netlify Functions          │
                   │                                 │
                   │  /api/github-auth               │
                   │     exchange OAuth code         │
                   │     for user access token       │
                   │                                 │
                   │  /api/submit-edit               │
                   │     verify user;                │
                   │     create branch, commit,      │
                   │     open PR as GitHub App       │
                   │                                 │
                   │  /api/list-edits  (review)      │
                   │  /api/get-edit    (review)      │
                   │  /api/merge-edit  (review)      │
                   └─────────────────────────────────┘
                              │              ▲
                              ▼              │
                   ┌─────────────────────────────────┐
                   │            GitHub               │
                   │                                 │
                   │  - user identity (OAuth)        │
                   │  - content repo (App writes)    │
                   │  - PRs, auto-merge, branch      │
                   │    protection, deploy preview   │
                   └─────────────────────────────────┘
                              │
                              ▼
                   ┌─────────────────────────────────┐
                   │           Netlify CI            │
                   │  rebuilds on merge to main      │
                   │  deploy previews per PR         │
                   └─────────────────────────────────┘
```

Key properties:

- **Reads are static and fast.** The tree is rendered to static HTML at build
  time. No server is involved when readers browse.
- **The only thing that needs a server** is the small set of GitHub-touching
  actions (OAuth code exchange, opening PRs, merging PRs). Those live in
  Netlify Functions, which spin up on demand and have zero idle cost.
- **The GitHub App holds the write capability**, not the user. Users never
  need write access to the repo. They just need a GitHub account to identify
  themselves.
- **Netlify Deploy Previews give per-PR preview URLs for free**, so reviewers
  can see the fully built site for any proposed edit.

---

## 4. Content storage

Each node in the tree is a folder under `content/` at the **project root**
(not `src/content/`, which is reserved by Astro 5 for content collections).
The node's own content lives in `_index.md` inside that folder. Children
are subfolders.

### Layout

```
content/
  _index.md                      # root node (the "home" page)
  introduction/
    _index.md
  part-one/
    _index.md
    chapter-1/
      _index.md
      section-a/
        _index.md
      section-b/
        _index.md
    chapter-2/
      _index.md
  part-two/
    _index.md
```

### `_index.md` shape

Frontmatter (YAML) describes the node; the body is the page content in
markdown.

```markdown
---
title: Chapter 1
order: [section-a, section-b]   # optional explicit child order;
                                # absent or empty = alphabetical by folder name
---

# Chapter 1

Body markdown goes here. Standard CommonMark / GitHub-flavoured markdown.

Images live under `public/` and are referenced with site-root paths:

![Description](/images/diagram.svg)
```

Notes on the format choice:

- **Markdown, not JSON blocks**, so PRs are diff-friendly and a maintainer can
  review changes on github.com if they prefer.
- **Folder name is the slug.** Renaming a node = renaming a folder, which is
  one PR. We don't expose this in the UI in v1.
- **Order is explicit when it matters**, alphabetical otherwise. Avoids
  encoding ordering into folder names (`01-foo/`, `02-bar/`) which would
  couple ordering to the URL.
- **No required ID field.** The path from the root uniquely identifies a node.

### Adding a node from the UI

When a contributor adds a new child page, the editor UI collects:
- title (string)
- slug (string, defaults to a kebab-cased title)
- markdown body

The submit function then:
- creates `content/<parent-path>/<slug>/_index.md` with the supplied
  frontmatter and body
- appends the new slug to the parent's `_index.md` frontmatter `order`
  array if one is present (otherwise leaves the parent alone — alphabetical
  ordering picks it up)
- opens that as a PR.

---

## 5. Tree loader and routing

### `src/lib/tree.ts`

A single recursive build-time loader that walks `content/` and produces
a typed in-memory tree.

```ts
export interface TreeNode {
  slug: string;           // folder name; "" for root
  path: string[];         // segments from root to this node (root = [])
  url: string;            // canonical URL ("/", "/a/b/c")
  title: string;          // from frontmatter
  body: string;           // raw markdown body
  parent: TreeNode | null;
  children: TreeNode[];   // ordered by frontmatter.order or alphabetical
}

export async function loadTree(): Promise<TreeNode> { /* ... */ }
```

Implementation notes:
- Uses Node's `fs` (Astro build is Node) to walk the directory.
- Parses frontmatter with `gray-matter` (already a tiny common dep).
- Markdown body is left as a string; rendering happens at the page level.
- Cached at module scope so it's loaded once per build.

### `src/lib/markdown.ts`

A thin wrapper around a markdown renderer (proposal: `marked` with
`marked-highlight` for code; or `react-markdown` if we want React-component
overrides). Returns HTML strings. Same renderer is used everywhere so the
`/review` preview matches the built page exactly.

### Routing

A single catch-all Astro page handles every node:

```
src/pages/[...path].astro
```

```astro
---
import Layout from "../layouts/Layout.astro";
import Sidebar from "../components/Sidebar";
import Breadcrumbs from "../components/Breadcrumbs.astro";
import PrevNext from "../components/PrevNext.astro";
import { loadTree, renderMarkdown, findNode } from "../lib/tree";

export async function getStaticPaths() {
  const root = await loadTree();
  return walk(root).map((node) => ({
    params: { path: node.path.join("/") || undefined },
    props: { node },
  }));
}

const { node } = Astro.props;
const tree = await loadTree();
const html = renderMarkdown(node.body);
---

<Layout title={node.title}>
  <Sidebar client:load tree={tree} currentPath={node.path} />
  <main>
    <Breadcrumbs node={node} />
    <article set:html={html} />
    <PrevNext node={node} tree={tree} />
  </main>
</Layout>
```

The root node is served at `/` (Astro passes `path: undefined` when the
catch-all segment is empty). Every other node is served at its URL.

---

## 6. Navigation UI

### Sidebar (React island)

Lifted in spirit from `example/iahc-app/src/components/Sidebar.jsx` but
rewritten to be recursive instead of two-level.

Behaviour:
- Renders the full tree as a nested list.
- Auto-expands the entire branch from root to the current node on first
  render.
- Marks the current node with an `aria-current="page"` and an `.active`
  class.
- Lets the user manually expand/collapse other branches; that state is held
  in the component (no persistence across reloads in v1).
- Mobile: a hamburger toggles the sidebar (slides in from the left).

Why a React island rather than pure Astro: expand/collapse interactivity is
genuinely useful and would otherwise need vanilla JS, which is more code.

### Breadcrumbs

Pure Astro component. Walks `node.parent` chain and renders links.
Always shows `Home › … › <current>`.

### Prev / Next

Pure Astro component. Computes the in-order traversal of the tree (depth-first
through `children` in declared order) and finds the predecessor and successor
of the current node. Renders two links at the bottom of the page.

### Edit button

A small button visible to logged-in users (or with `?edit=true`), positioned
in the page header. Clicking it navigates to `/edit/<path>`.

---

## 7. GitHub OAuth — full flow

This entire mechanism is lifted from `example/iahc-app/`. The only behavioural
difference is the choice of client_id (it points at our new GitHub App
instead of an OAuth App) and the addition of one more piece of information we
verify (the user's login is later used to attribute the PR).

We use **a single GitHub App** for both:
- User identity (the OAuth flow described in this section).
- Repo write capability (an installation token, see [§8](#8-editing--submitting-a-change)
  and [§11](#11-github-app--setup)).

GitHub Apps support an OAuth-style user-authorisation flow that is identical
on the wire to OAuth Apps. The endpoints are the same; the only difference
is that the resulting "user-to-server" token is short-lived and tied to the
App's installation permissions.

### The flow, step by step

```
Browser                 Our Netlify Function           GitHub
   │                            │                        │
   │  click "Log in with GitHub"│                        │
   │                            │                        │
   │  GET github.com/login/oauth/authorize?              │
   │      client_id=<APP>&redirect_uri=…&state=…         │
   │ ──────────────────────────────────────────────────► │
   │                            │                        │
   │  user approves on github.com                        │
   │                            │                        │
   │  302 → /auth/callback?code=…&state=…                │
   │ ◄────────────────────────────────────────────────── │
   │                            │                        │
   │  page loads; JS:           │                        │
   │  verify state; POST /api/github-auth { code }       │
   │ ──────────────────────────►│                        │
   │                            │                        │
   │                            │  POST github.com/login/oauth/access_token
   │                            │  { client_id, client_secret, code }
   │                            │ ─────────────────────► │
   │                            │ ◄───────────────────── │
   │                            │      { access_token }  │
   │                            │                        │
   │ ◄──────────────────────────│                        │
   │     { access_token }       │                        │
   │                            │                        │
   │  store token in sessionStorage                      │
   │  GET api.github.com/user with Bearer token          │
   │ ──────────────────────────────────────────────────► │
   │ ◄────────────────────────────────────────────────── │
   │     { login, avatar_url }                           │
   │  store user in sessionStorage; redirect to return URL
   │                            │                        │
```

### Step-by-step detail

**Step 1 — initiate login.** When the user clicks **Log in with GitHub**, the
client builds the authorize URL and redirects. Lifted directly from
`EditModeGate.jsx:101-112`:

```ts
function startLogin() {
  const state = crypto.randomUUID();
  sessionStorage.setItem("gh-oauth-state", state);
  sessionStorage.setItem("gh-oauth-return", window.location.href);

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", import.meta.env.PUBLIC_GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${window.location.origin}/auth/callback`);
  url.searchParams.set("state", state);

  window.location.href = url.toString();
}
```

Notes:
- `state` is a random string saved to `sessionStorage` and echoed by GitHub
  on the way back. The callback verifies the echo matches what we stored; if
  not, the request is rejected. This prevents CSRF.
- `gh-oauth-return` is the URL the user was on when they clicked log in. The
  callback restores this so the user lands back where they started.
- `client_id` is **public** — safe to ship in the static bundle via a
  `PUBLIC_GITHUB_CLIENT_ID` environment variable.
- **We do not request any scopes.** Identity is all we need from the user;
  any repo writes are done by the App's installation token, not the user's
  token. (GitHub Apps' user-to-server tokens are scoped by the App's
  installation permissions, not by the `scope` query parameter, which is an
  OAuth-App-only mechanism.)

**Step 2 — GitHub redirects back to `/auth/callback?code=…&state=…`.**
The callback is a static Astro page with inline JavaScript. Reused almost
verbatim from `example/iahc-app/src/pages/auth/callback.astro`:

```html
<script>
  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    const stored = sessionStorage.getItem("gh-oauth-state");
    if (!state || state !== stored) { fail("state mismatch"); return; }
    sessionStorage.removeItem("gh-oauth-state");

    if (!code) { fail("no code received"); return; }

    const res = await fetch("/api/github-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { fail(data.error); return; }

    sessionStorage.setItem("gh-token", data.access_token);

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (userRes.ok) {
      const u = await userRes.json();
      sessionStorage.setItem("gh-user", JSON.stringify({
        login: u.login,
        avatar_url: u.avatar_url,
      }));
    }

    const returnTo = sessionStorage.getItem("gh-oauth-return") || "/";
    sessionStorage.removeItem("gh-oauth-return");
    window.location.href = returnTo;
  }
  handleCallback();
</script>
```

**Step 3 — Netlify Function exchanges the code.**
Lifted from `example/iahc-app/netlify/functions/github-auth.js`. The only
thing this function does is keep `GITHUB_CLIENT_SECRET` off the client.

```js
// netlify/functions/github-auth.js
const getEnv = (key) =>
  (typeof Netlify !== "undefined" && Netlify.env)
    ? Netlify.env.get(key)
    : process.env[key];

export default async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { code } = await request.json();
  if (!code) return json({ error: "missing code" }, 400);

  const clientId = getEnv("GITHUB_CLIENT_ID");
  const clientSecret = getEnv("GITHUB_CLIENT_SECRET");
  if (!clientId || !clientSecret) return json({ error: "OAuth not configured" }, 500);

  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const data = await r.json();
  if (data.error) return json({ error: data.error_description || data.error }, 400);
  return json({ access_token: data.access_token, scope: data.scope });
};

export const config = { path: "/api/github-auth" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
```

**Step 4 — Token persistence.**
- `gh-token` is stored in `sessionStorage`. This means the login lasts only
  for the browser session (it's cleared when the tab closes). This is a
  deliberate, low-risk default carried over from iahc-app.
- `gh-user` (login + avatar URL) is stored alongside for UI display.

**Step 5 — Logout.** Clearing both keys is enough. There is no GitHub-side
revocation in v1; users who want to fully revoke can do so via their GitHub
*Settings → Applications*.

### Verifying the user server-side

When the submit function receives a request, it does not trust the username
from the client. It re-fetches `GET https://api.github.com/user` with the
supplied token, and uses **that** response as the authoritative identity.
The token came from GitHub via our secret-protected exchange, so this loop
ties the request to a real user.

```js
async function verifyUser(token) {
  const r = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("invalid token");
  return r.json(); // { login, id, avatar_url, ... }
}
```

---

## 8. Editing — submitting a change

When a logged-in user clicks **Save** in the editor:

1. The client POSTs to `/api/submit-edit`:

   ```ts
   {
     userToken: string,           // from sessionStorage gh-token
     mode: "edit" | "create",
     parentPath: string[],        // ["part-one", "chapter-1"]
     slug: string,                // "section-a"  (== parentPath leaf for edit)
     title: string,
     body: string,                // markdown
   }
   ```

2. The function `verifyUser(userToken)` → gets `{ login }`.
3. The function gets a **GitHub App installation token** (see
   [§11](#11-github-app--setup) for setup, library: `@octokit/auth-app`).
4. Using the installation token, the function:
   1. Reads the current `main` commit SHA: `GET /repos/:o/:r/git/ref/heads/main`.
   2. Creates a branch: `POST /repos/:o/:r/git/refs`
      with `ref: refs/heads/edit/<login>/<shortid>`, `sha: <main sha>`.
   3. PUTs the file:
      `PUT /repos/:o/:r/contents/content/<path>/_index.md` with
      `branch: edit/<login>/<shortid>`, base64 content, and a commit message:

      ```
      Edit <title> (<path>)

      Co-authored-by: <login> <<login>@users.noreply.github.com>
      ```

      The `Co-authored-by` trailer is what makes GitHub attribute the edit to
      the contributor even though the App is the committer.
   4. For `mode: "create"`, also updates the parent's `_index.md` to append
      the new slug to `order` (if `order` is present).
   5. Opens the PR: `POST /repos/:o/:r/pulls` with `head` = the new branch,
      `base` = `main`, a title, and a body that links to the new content's
      preview URL on the deploy preview.

5. The function returns `{ pr_number, pr_url, branch }` to the client. The
   editor UI shows a confirmation modal with the PR link.

### Why a Function and not a direct browser → GitHub call

iahc-app's existing code commits directly from the browser using the user's
OAuth token. That works only because the user has write access to the repo.
For a PR-gated CMS where contributors are not collaborators, we need the
**App's** identity, and the App's private key must never reach the browser —
so this step has to live in a Function.

### Commit attribution

GitHub will display the App as the *committer* and the user (via
`Co-authored-by`) as a *co-author*. The author shown in the PR header is the
App, but the user's name appears in the commit and in PR participants. If we
later want the user to be the *author* and the App to be the *committer*,
we can use the Git Data API
(create blob → create tree → create commit with separate author/committer)
instead of the simpler Contents API. v1 stays with the Contents API for
simplicity; the trade-off is purely cosmetic.

---

## 9. Trust tiers and auto-merge

Tracking who is trusted:

`data/trusted-contributors.json`:

```json
{
  "trusted": ["larsgson"]
}
```

The list lives in the repo itself, so promoting a contributor is one PR.
The submit function reads this file (it's checked into the repo and the App
has access).

After the PR is opened, if the verified user's `login` is in the trusted
list, the function enables auto-merge on the PR via the GraphQL API:

```graphql
mutation EnableAutoMerge($prId: ID!) {
  enablePullRequestAutoMerge(input: {
    pullRequestId: $prId,
    mergeMethod: SQUASH
  }) {
    pullRequest { number }
  }
}
```

Auto-merge requires:
- Branch protection enabled on `main` with at least one required check (e.g.,
  the Netlify build).
- The "Allow auto-merge" option enabled in the repo's settings.

Once both are set, auto-merge on a PR means: as soon as the required checks
go green, GitHub merges automatically. If a check fails, the PR stays open
and a human can intervene.

For untrusted users, the PR sits open and awaits a reviewer. That's the
job of the dashboard.

---

## 10. Editor dashboard (`/review`)

A single page, gated to users whose GitHub login is in a "reviewers" set.

### Gating

`data/reviewers.json`:

```json
{
  "reviewers": ["larsgson"]
}
```

Client-side: if `gh-user.login` is not in this set, the page renders
"Reviewers only" and a link home. Real enforcement is server-side: the
review functions also check this list before doing anything.

### UI

A list of open edit PRs, each row showing:
- Title
- Author (the user, not the App — extracted from the `Co-authored-by`
  trailer or from the PR body)
- Path being edited
- Created / updated timestamps
- "Open" link → expands an inline preview pane:
  - Side-by-side rendered preview: current page (from `main`) on the left,
    proposed page (from PR head) on the right. Both rendered with the same
    markdown component used on the live site.
  - A **Merge** button → calls `/api/merge-edit`.
  - A **View on GitHub** link for nuanced discussion (comments, request
    changes).

### Supporting Netlify Functions

**`/api/list-edits`** — uses the App installation token to call
`GET /repos/:o/:r/pulls?state=open`. Filters to PRs from branches matching
`edit/*` (so unrelated PRs don't clutter the list). Returns the metadata
the dashboard needs.

**`/api/get-edit`** — given a PR number, fetches the file content from
**both** refs: `GET /repos/:o/:r/contents/:path?ref=main` and `?ref=<pr head sha>`.
Returns both as plain markdown plus titles parsed from frontmatter.

**`/api/merge-edit`** — given a PR number, calls
`PUT /repos/:o/:r/pulls/:n/merge` with `merge_method: "squash"`. Returns the
merge SHA. The dashboard removes the row and shows a "merged" toast.

All three functions verify the caller's user token, look up the login, and
reject if not in `reviewers.json`.

### Per-PR live preview

Netlify Deploy Previews automatically build a preview site for every PR.
The dashboard's preview pane uses the **same markdown renderer** as the
live site, but if the reviewer wants to click around the proposed site in
full, the **Open Deploy Preview** link takes them straight to it.

---

## 11. GitHub App — setup

### Why a GitHub App, not an OAuth App + PAT

- A GitHub App is **scoped to one repo** (or a set), so its blast radius is
  limited.
- It has **fine-grained permissions** (contents:write, pull_requests:write).
- It can act as itself when committing, keeping the user's token out of
  scope of repo writes.
- It supports the **user-to-server OAuth** flow, so we don't need a separate
  OAuth App for identity.
- Its installation token is **rotated every hour** and minted on demand.

### Creation steps (one-time)

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **GitHub App name**: pick a unique name (used in commit attribution).
3. **Homepage URL**: the production site URL.
4. **Callback URL**: `https://<production-domain>/auth/callback`. (You can
   add a second for local development if needed.)
5. **Request user authorization (OAuth) during installation**: enabled.
6. **Webhook**: disabled for v1. (We don't need GitHub to call us; we call
   GitHub when actions happen.)
7. **Repository permissions**:
   - **Contents**: Read and write
   - **Pull requests**: Read and write
   - **Metadata**: Read (granted by default)
8. **Where can this GitHub App be installed?**: Only on this account.
9. After creation:
   - Note the **App ID**.
   - Generate a **private key** (`.pem`) — store this securely.
   - On the App settings page, note the **Client ID** and generate a
     **Client secret**.
10. **Install the App** on the content repo (App settings → Install App →
    pick the repo).
11. After installation, note the **Installation ID**.

### Generating an installation token in the function

Use `@octokit/auth-app`:

```js
import { createAppAuth } from "@octokit/auth-app";

const auth = createAppAuth({
  appId: getEnv("GITHUB_APP_ID"),
  privateKey: getEnv("GITHUB_APP_PRIVATE_KEY"),
  installationId: getEnv("GITHUB_APP_INSTALLATION_ID"),
});

async function installationToken() {
  const { token } = await auth({ type: "installation" });
  return token;
}
```

The function then uses this token in the `Authorization: Bearer` header for
all repo-modifying API calls.

### Branch protection

In the repo's **Settings → Branches**:
- Protect `main`.
- Require status checks before merging (at minimum, the Netlify build).
- Enable **Allow auto-merge** in the repo's general settings (so the
  trusted-tier auto-merge can fire).

---

## 12. Environment variables

Set in Netlify → **Site settings → Environment variables**.

| Name | Where used | Notes |
|---|---|---|
| `GITHUB_CLIENT_ID` | server (`/api/github-auth`) | from the App's OAuth section |
| `GITHUB_CLIENT_SECRET` | server (`/api/github-auth`) | from the App's OAuth section |
| `GITHUB_APP_ID` | server (submit / review functions) | numeric App ID |
| `GITHUB_APP_PRIVATE_KEY` | server | full `.pem` contents incl. begin/end lines |
| `GITHUB_APP_INSTALLATION_ID` | server | numeric, post-install |
| `CONTENT_REPO_OWNER` | server | owner of the **content** repo (e.g. `larsgson`) |
| `CONTENT_REPO_NAME` | server | name of the **content** repo |
| `CONTENT_SOURCE` | build | optional; `owner/repo[@ref]`. If unset, build uses the local `content/` folder (mode A). If set, build replaces it with the named repo's `content/` (mode B). See [§17](#17-multi-site-configuration). |
| `CONTENT_FETCH_TOKEN` | build | optional; required only when `CONTENT_SOURCE` points at a private repo |
| `PUBLIC_GITHUB_CLIENT_ID` | client (login button) | same value as `GITHUB_CLIENT_ID`; Astro inlines `PUBLIC_*` into the bundle |

The `PUBLIC_GITHUB_CLIENT_ID` duplication is intentional: server-side code
should not depend on `PUBLIC_*` vars, and client-side code should not have
access to the non-public ones. Astro enforces this at build time.

---

## 13. File layout to be created

```
navtree-cluster/
├── astro.config.mjs                      [edit]
├── docs/
│   └── cms-plan.md                       [this file]
├── content/                              [project-root content tree]
│   ├── _index.md
│   └── …
├── package.json                          [edit: add deps]
├── netlify.toml                          [add]
├── src/
│   ├── data/
│   │   ├── trusted-contributors.json
│   │   └── reviewers.json
│   ├── lib/
│   │   ├── tree.ts                       [recursive loader]
│   │   ├── markdown.ts                   [renderer wrapper]
│   │   └── github.ts                     [client helpers: fetch user, etc.]
│   ├── layouts/
│   │   └── Layout.astro
│   ├── components/
│   │   ├── Sidebar.tsx                   [React island — lifted from iahc-app]
│   │   ├── Breadcrumbs.astro
│   │   ├── PrevNext.astro
│   │   ├── EditButton.tsx                [appears for logged-in users]
│   │   ├── PageEditor.tsx                [textarea + markdown preview]
│   │   └── ReviewDashboard.tsx           [for /review]
│   ├── pages/
│   │   ├── [...path].astro               [reader page]
│   │   ├── edit/
│   │   │   └── [...path].astro           [editor page]
│   │   ├── review.astro                  [dashboard]
│   │   └── auth/
│   │       └── callback.astro            [OAuth landing]
│   └── styles/                           [tailwind only; minimal]
└── netlify/
    └── functions/
        ├── github-auth.js                [code → access_token]
        ├── submit-edit.js                [branch + commit + PR]
        ├── list-edits.js                 [for /review]
        ├── get-edit.js                   [for /review]
        └── merge-edit.js                 [for /review]
```

---

## 14. Implementation order

The order is chosen so that each step produces something usable, and so that
GitHub-touching work happens last (when the App credentials are ready).

1. **Tree skeleton.** Seed `content/` with 3–5 hand-written nodes.
   Implement `src/lib/tree.ts` and `src/lib/markdown.ts`.
2. **Routing + Layout.** `[...path].astro` renders any node with a plain
   layout. No sidebar yet — just verify all paths resolve.
3. **Sidebar + Breadcrumbs + PrevNext.** Tree navigation works end-to-end.
   This is the "core feature" milestone.
4. **Tailwind styling pass.** Make the read experience look right.
5. **Editor UI (mock submit).** `/edit/[...path]` shows a textarea + live
   preview, with a "Save" button that just `console.log`s the payload.
   No GitHub wiring yet.
6. **GitHub App setup.** Create the App, install it, set env vars in
   Netlify, create the repo. *Now* the OAuth and submit functions have
   credentials to work against.
7. **OAuth.** Implement `github-auth.js` (lift from iahc-app), `/auth/callback.astro`,
   the **Log in with GitHub** button, and sessionStorage persistence.
8. **Submit function.** `submit-edit.js`. Editor "Save" button calls it.
   At this point a non-trusted user can submit an edit and see the PR
   appear on GitHub.
9. **Trusted auto-merge.** Add `trusted-contributors.json` and the
   GraphQL auto-merge call.
10. **Review dashboard.** `/review` plus the three new functions
    (`list-edits`, `get-edit`, `merge-edit`).
11. **Polish:** error states, empty states, responsive sidebar, etc.

Steps 1–5 require no GitHub or Netlify setup, so they can start
immediately and provide a working prototype to demo before any operational
work.

---

## 15. Out of scope (v1)

- Image upload via the UI.
- Renaming / moving / deleting nodes via the UI.
- Inline editing of arbitrary HTML; we deliberately accept only markdown.
- Multi-language support.
- Anonymous contributions (everyone must log in with GitHub).
- Drafts saved server-side. Drafts live in the user's `sessionStorage` only.
- Comment threads on PRs from inside the dashboard (use the GitHub link).
- Migrating existing content from either of the `example/` apps. The
  `example/` directory is reference material and not a source of content.

---

## 16. Open questions

These are decisions worth confirming as implementation begins, but not
blockers:

1. **Markdown renderer.** `marked` (HTML string, simple) vs. `react-markdown`
   (component overrides, slightly larger bundle). Default proposal:
   `marked`, used in both the static page and the live preview, so what the
   editor sees matches what the reader sees.
2. **Editor.** Plain `<textarea>` + preview (proposal for v1) vs. CodeMirror
   in markdown mode vs. a richer editor. Starting with `<textarea>` keeps
   the bundle small and the surface honest — power users already know
   markdown.
3. **Where to put the GitHub repo for content.** Same repo as the app, or a
   separate content repo with the app reading it as a git submodule /
   sparse-checkout at build time? Same-repo is simpler and the proposed
   default; separate-repo lets non-developers operate without seeing the
   code.
4. **Squash, merge, or rebase on auto-merge?** Proposal: **squash**, so
   `main`'s history reads "one commit per edit." But "merge" preserves the
   `Co-authored-by` more visibly. Worth a check before turning on
   auto-merge.
5. **OAuth on a custom domain vs. `*.netlify.app`.** The App's callback URL
   has to match the deployed origin. Either commit to a custom domain
   early, or add the `*.netlify.app` URL as an extra callback during
   development.

---

## 17. Multi-site configuration

The client app (this repository, eventually renamed `nav-cluster-web`) is
designed so that one shared codebase can serve **one or many content
repositories** without forking. Two deployment modes are supported with the
same code:

### Mode A — content in the client repo (default, current setup)

The `content/` folder lives at the project root and is committed to this
repo. The Netlify Functions write back to the same repo. One client = one
site = one content repo, all in one place.

This is the only mode in use today. The build script is a no-op for content
fetching: it just runs `astro build`.

Required env vars:
- `CONTENT_REPO_OWNER` / `CONTENT_REPO_NAME` — set to **this** repo's coords.
- All of the OAuth + GitHub App vars from [§12](#12-environment-variables).

### Mode B — separate content repos, one per site

The same client codebase is deployed N times to N Netlify sites, each
pointing at a different content repo. Switching a site to mode B is a
matter of environment variables; no code change.

How the content gets into the build:

```
[client repo: nav-cluster-web]   ←── deployed N times to N Netlify sites
                                       │
                                       │  prebuild step
                                       ▼
[content repo A: acme/site-content]  →  content/  →  astro build  →  Site A
[content repo B: example/handbook]   →  content/  →  astro build  →  Site B
```

The build script runs `node scripts/fetch-content.js` before `astro build`:

- If `CONTENT_SOURCE` is **unset** (mode A), the script is a no-op and the
  local checked-in `content/` is used.
- If `CONTENT_SOURCE` is **set** to `owner/repo[@ref]`, the script downloads
  the tarball of that repo at that ref, extracts its `content/` folder, and
  replaces the local one before Astro runs.

Required env vars in mode B:
- `CONTENT_SOURCE = "owner/repo"` or `"owner/repo@branch-or-tag"` (default
  ref: `main`).
- `CONTENT_FETCH_TOKEN` — only required if the content repo is private.
  A Personal Access Token with `contents:read` on the content repo works,
  as does an installation token minted out-of-band from the GitHub App
  (recommended for ops parity with the editing flow).
- `CONTENT_REPO_OWNER` / `CONTENT_REPO_NAME` — same `owner/repo` as the
  source, so the editing functions write to the right place.
- All of the OAuth + GitHub App vars, with the **same GitHub App installed
  on each content repo**.

### Promoting a site from A to B

1. Create the content repo (e.g. `acme/site-content`).
2. Move (or copy) `content/` from the client repo into the new repo's root.
3. Move `data/trusted-contributors.json` and `data/reviewers.json`
   into the new content repo (the functions already read them via the
   GitHub API, so they can live anywhere the App can read — keeping them
   alongside the content keeps governance of editors with the content).
4. Install the GitHub App on the content repo and note the new
   `INSTALLATION_ID`.
5. In Netlify, set `CONTENT_SOURCE`, switch `CONTENT_REPO_OWNER` /
   `CONTENT_REPO_NAME` to the new repo, and update
   `GITHUB_APP_INSTALLATION_ID`.
6. Trigger a rebuild. The site now reads from the new content repo.

The client repo itself is unchanged through all of this.

### Why this works as-is

- The static client app never reads `content/` at runtime — only at build
  time. So mode B is just "swap what `content/` contains before the build."
- The Netlify Functions never read content from disk — they fetch
  everything (markdown files, trusted/reviewers lists) via the GitHub API
  using the App installation token. So they're already
  content-repo-agnostic; only env vars decide which repo they touch.
- The OAuth flow has nothing to do with the content repo — it just
  authenticates a GitHub user. One OAuth app serves all sites (the App's
  callback URLs can list multiple origins).

### What does *not* multi-tenant inside a single deployment

This design supports many *sites* sharing one *codebase*, but each Netlify
deployment serves exactly one content repo. True per-request tenancy
(one Netlify site, many content repos behind different hostnames) would
require switching to SSR and is deliberately out of scope.
