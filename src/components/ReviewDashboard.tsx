import { useEffect, useState } from "react"
import { getToken, getUser, startLogin } from "../lib/auth-client"
import { renderMarkdown } from "../lib/markdown"

interface Edit {
  number: number
  title: string
  url: string
  head_ref: string
  head_sha: string
  created_at: string
  updated_at: string
  author_login: string | null
}

interface FileDiff {
  filename: string
  status: string
  before: string
  after: string
}

interface DetailData {
  pr: {
    number: number
    title: string
    body: string
    url: string
    mergeable: boolean | null
    mergeable_state: string
  }
  files: FileDiff[]
}

interface Props {
  clientId: string
}

export default function ReviewDashboard({ clientId }: Props) {
  const [hydrated, setHydrated] = useState(false)
  const [token, setToken] = useState("")
  const [user, setUser] = useState<{ login: string; avatar_url: string } | null>(
    null,
  )
  const [edits, setEdits] = useState<Edit[] | null>(null)
  const [error, setError] = useState("")
  const [openPr, setOpenPr] = useState<number | null>(null)
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    setHydrated(true)
    setToken(getToken())
    setUser(getUser())
  }, [])

  useEffect(() => {
    if (!token) return
    fetch("/api/list-edits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userToken: token }),
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || `Failed (${r.status})`)
        setEdits(data.edits)
      })
      .catch((e) => setError(e.message))
  }, [token])

  const openDetail = async (n: number) => {
    if (openPr === n) {
      setOpenPr(null)
      setDetail(null)
      return
    }
    setOpenPr(n)
    setDetail(null)
    setLoadingDetail(true)
    try {
      const r = await fetch("/api/get-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: token, prNumber: n }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`)
      setDetail(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingDetail(false)
    }
  }

  const merge = async (n: number) => {
    if (!confirm(`Merge PR #${n}?`)) return
    setMerging(true)
    try {
      const r = await fetch("/api/merge-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: token, prNumber: n }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`)
      setEdits((prev) => prev?.filter((e) => e.number !== n) ?? null)
      setOpenPr(null)
      setDetail(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setMerging(false)
    }
  }

  if (!hydrated) return <div className="p-8 text-gray-500">Loading…</div>

  if (!token || !user) {
    return (
      <div className="px-6 py-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Reviewers only</h1>
        <p className="text-gray-600 mb-4">
          Log in with GitHub to access the review dashboard.
        </p>
        {clientId && (
          <button
            onClick={() => startLogin(clientId)}
            className="bg-primary text-white px-4 py-2 rounded font-medium hover:bg-primary-light"
          >
            Log in with GitHub
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto w-full">
      <h1 className="text-2xl font-bold mb-6">Pending edits</h1>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 p-3 rounded border border-red-200 mb-4">
          {error}
        </div>
      )}

      {edits === null ? (
        <div className="text-gray-500">Loading edits…</div>
      ) : edits.length === 0 ? (
        <div className="text-gray-500">No open edits.</div>
      ) : (
        <ul className="space-y-3">
          {edits.map((e) => (
            <li
              key={e.number}
              className="border border-gray-200 rounded bg-white"
            >
              <div className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    by <strong>@{e.author_login || "unknown"}</strong> ·{" "}
                    {new Date(e.created_at).toLocaleString()} ·{" "}
                    <code className="text-gray-700">{e.head_ref}</code>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openDetail(e.number)}
                    className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded"
                  >
                    {openPr === e.number ? "Hide" : "Open"}
                  </button>
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener"
                    className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded"
                  >
                    GitHub
                  </a>
                  <button
                    onClick={() => merge(e.number)}
                    disabled={merging}
                    className="text-sm bg-primary text-white hover:bg-primary-light px-3 py-1 rounded disabled:opacity-50"
                  >
                    Merge
                  </button>
                </div>
              </div>

              {openPr === e.number && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  {loadingDetail && (
                    <div className="text-gray-500">Loading preview…</div>
                  )}
                  {detail &&
                    detail.files.map((f) => (
                      <div key={f.filename} className="mb-6">
                        <div className="text-xs font-mono text-gray-600 mb-2">
                          {f.filename}{" "}
                          <span className="ml-2 px-2 py-0.5 rounded bg-gray-200">
                            {f.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <DiffSide label="Current" md={f.before} />
                          <DiffSide label="Proposed" md={f.after} />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DiffSide({ label, md }: { label: string; md: string }) {
  const stripped = md.replace(/^---\n[\s\S]*?\n---\n?/, "")
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 mb-1">{label}</div>
      <div
        className="prose-content border border-gray-200 rounded p-3 bg-white text-sm"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(stripped) }}
      />
    </div>
  )
}
