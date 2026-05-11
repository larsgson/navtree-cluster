import { useEffect, useMemo, useRef, useState } from "react"
import { getToken, getUser, startLogin } from "../lib/auth-client"
import { renderMarkdown } from "../lib/markdown"

interface Props {
  mode: "edit" | "create"
  parentPath: string[]
  initialSlug: string
  initialTitle: string
  initialBody: string
  parentUrl: string
  nodeUrl: string
  clientId: string
}

export default function PageEditor({
  mode,
  parentPath,
  initialSlug,
  initialTitle,
  initialBody,
  parentUrl,
  nodeUrl,
  clientId,
}: Props) {
  const [hydrated, setHydrated] = useState(false)
  const [token, setToken] = useState("")
  const [user, setUser] = useState<{ login: string; avatar_url: string } | null>(
    null,
  )
  const [title, setTitle] = useState(initialTitle)
  const [slug, setSlug] = useState(initialSlug)
  const [body, setBody] = useState(initialBody)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ pr_url: string } | null>(null)
  const [error, setError] = useState("")
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setHydrated(true)
    setToken(getToken())
    setUser(getUser())
  }, [])

  const previewHtml = useMemo(() => renderMarkdown(body || ""), [body])

  const isLoggedIn = !!token && !!user

  const onTitleChange = (v: string) => {
    setTitle(v)
    if (mode === "create" && slug === slugify(title)) {
      setSlug(slugify(v))
    }
  }

  const onSubmit = async () => {
    setSaving(true)
    setError("")
    setResult(null)
    try {
      const res = await fetch("/api/submit-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken: token,
          mode,
          parentPath,
          slug,
          title,
          body,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setResult({ pr_url: data.pr_url })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!hydrated) {
    return <div className="px-6 py-8 text-gray-500">Loading editor…</div>
  }

  if (!isLoggedIn) {
    return (
      <div className="px-6 py-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Sign in to edit</h1>
        <p className="text-gray-600 mb-6">
          You need a GitHub account to propose changes. Edits go through a Pull
          Request — they are not published until reviewed.
        </p>
        {clientId ? (
          <button
            onClick={() => startLogin(clientId)}
            className="bg-primary text-white px-4 py-2 rounded font-medium hover:bg-primary-light"
          >
            Log in with GitHub
          </button>
        ) : (
          <p className="text-red-600 text-sm">
            <code>PUBLIC_GITHUB_CLIENT_ID</code> is not configured.
          </p>
        )}
      </div>
    )
  }

  if (result) {
    return (
      <div className="px-6 py-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Submitted ✔</h1>
        <p className="text-gray-700 mb-4">
          Your change is now a Pull Request. It will appear on the live site
          once a reviewer merges it.
        </p>
        <div className="flex gap-3">
          <a
            href={result.pr_url}
            target="_blank"
            rel="noopener"
            className="bg-primary text-white px-4 py-2 rounded font-medium hover:bg-primary-light"
          >
            View Pull Request
          </a>
          <a
            href={mode === "create" ? parentUrl : nodeUrl}
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded font-medium"
          >
            Back to page
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">
          {mode === "edit" ? "Editing: " : "New page under: "}
          <code className="text-base font-mono text-gray-600">
            {mode === "edit"
              ? nodeUrl
              : parentUrl === "/"
                ? "/"
                : parentUrl + "/"}
          </code>
        </h1>
        <a
          href={mode === "edit" ? nodeUrl : parentUrl}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          Cancel
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          {mode === "create" && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Slug (URL segment)
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              Body (markdown)
            </label>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={20}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded border border-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={onSubmit}
              disabled={saving || !title || !slug}
              className="bg-primary text-white px-4 py-2 rounded font-medium hover:bg-primary-light disabled:opacity-50"
            >
              {saving
                ? "Submitting…"
                : mode === "edit"
                  ? "Submit edit as PR"
                  : "Submit new page as PR"}
            </button>
            <span className="text-sm text-gray-500">
              as <strong>{user!.login}</strong>
            </span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Preview</label>
          <div
            className="prose-content border border-gray-200 rounded p-4 bg-white min-h-[20rem]"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>
    </div>
  )
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
