import fs from "node:fs"
import path from "node:path"
import matter from "gray-matter"

const CONTENT_ROOT = path.resolve(process.cwd(), "content")

export interface TreeNode {
  slug: string
  segments: string[]
  url: string
  title: string
  body: string
  parent: TreeNode | null
  children: TreeNode[]
}

let cached: TreeNode | null = null

export function loadTree(): TreeNode {
  if (cached) return cached
  cached = buildNode(CONTENT_ROOT, [], null)
  return cached
}

function buildNode(
  dirAbs: string,
  segments: string[],
  parent: TreeNode | null,
): TreeNode {
  const indexPath = path.join(dirAbs, "_index.md")
  let title = segments[segments.length - 1] ?? ""
  let body = ""
  let frontOrder: string[] | undefined

  if (fs.existsSync(indexPath)) {
    const raw = fs.readFileSync(indexPath, "utf-8")
    const parsed = matter(raw)
    body = parsed.content
    if (typeof parsed.data.title === "string") title = parsed.data.title
    if (Array.isArray(parsed.data.order)) {
      frontOrder = parsed.data.order.map(String)
    }
  }

  const slug = segments[segments.length - 1] ?? ""
  const url = segments.length === 0 ? "/" : "/" + segments.join("/")

  const node: TreeNode = {
    slug,
    segments,
    url,
    title,
    body,
    parent,
    children: [],
  }

  const childSlugs = fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)

  let ordered: string[]
  if (frontOrder && frontOrder.length > 0) {
    const set = new Set(childSlugs)
    ordered = frontOrder.filter((s) => set.has(s))
    for (const s of childSlugs) {
      if (!ordered.includes(s)) ordered.push(s)
    }
  } else {
    ordered = [...childSlugs].sort()
  }

  node.children = ordered.map((childSlug) =>
    buildNode(path.join(dirAbs, childSlug), [...segments, childSlug], node),
  )

  return node
}

export function findNode(root: TreeNode, segments: string[]): TreeNode | null {
  let cur: TreeNode = root
  for (const s of segments) {
    const next = cur.children.find((c) => c.slug === s)
    if (!next) return null
    cur = next
  }
  return cur
}

export function allNodes(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    out.push(n)
    for (const c of n.children) walk(c)
  }
  walk(root)
  return out
}

export function prevNext(
  root: TreeNode,
  node: TreeNode,
): { prev: TreeNode | null; next: TreeNode | null } {
  const list = allNodes(root)
  const idx = list.findIndex((n) => n.url === node.url)
  return {
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
  }
}

export function breadcrumbs(node: TreeNode): TreeNode[] {
  const chain: TreeNode[] = []
  let cur: TreeNode | null = node
  while (cur) {
    chain.unshift(cur)
    cur = cur.parent
  }
  return chain
}

export interface SerializableNode {
  slug: string
  url: string
  title: string
  children: SerializableNode[]
}

export function serialize(node: TreeNode): SerializableNode {
  return {
    slug: node.slug,
    url: node.url,
    title: node.title,
    children: node.children.map(serialize),
  }
}
