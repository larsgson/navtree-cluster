import { useEffect, useMemo, useState } from "react"
import type { SerializableNode } from "../lib/tree"

interface Props {
  tree: SerializableNode
  currentUrl: string
}

export default function Sidebar({ tree, currentUrl }: Props) {
  const ancestors = useMemo(() => collectAncestors(tree, currentUrl), [
    tree,
    currentUrl,
  ])

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestors),
  )

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const a of ancestors) next.add(a)
      return next
    })
  }, [ancestors])

  const toggle = (url: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })

  return (
    <nav className="sidebar-root w-[280px] shrink-0 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]">
      <ul className="text-sm">
        <NodeRow
          node={tree}
          depth={0}
          currentUrl={currentUrl}
          expanded={expanded}
          toggle={toggle}
        />
      </ul>
    </nav>
  )
}

interface RowProps {
  node: SerializableNode
  depth: number
  currentUrl: string
  expanded: Set<string>
  toggle: (url: string) => void
}

function NodeRow({ node, depth, currentUrl, expanded, toggle }: RowProps) {
  const isActive = node.url === currentUrl
  const isOpen = expanded.has(node.url)
  const hasChildren = node.children.length > 0

  return (
    <li>
      <div
        className="flex items-center gap-1 py-1"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => toggle(node.url)}
            className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-900"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            <span
              style={{
                display: "inline-block",
                transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
              }}
            >
              ▶
            </span>
          </button>
        ) : (
          <span className="w-5 h-5 inline-block" />
        )}
        <a
          href={node.url}
          aria-current={isActive ? "page" : undefined}
          className={
            "flex-1 truncate rounded px-2 py-1 " +
            (isActive
              ? "bg-primary text-white font-medium"
              : "text-gray-800 hover:bg-gray-200")
          }
        >
          {node.title || node.slug || "Home"}
        </a>
      </div>
      {hasChildren && isOpen && (
        <ul>
          {node.children.map((c) => (
            <NodeRow
              key={c.url}
              node={c}
              depth={depth + 1}
              currentUrl={currentUrl}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function collectAncestors(root: SerializableNode, url: string): string[] {
  const out: string[] = []
  const walk = (n: SerializableNode, chain: string[]): boolean => {
    const next = [...chain, n.url]
    if (n.url === url) {
      out.push(...next)
      return true
    }
    for (const c of n.children) {
      if (walk(c, next)) {
        out.push(...next)
        return true
      }
    }
    return false
  }
  walk(root, [])
  return Array.from(new Set(out))
}
