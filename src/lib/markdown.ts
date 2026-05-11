import { Marked } from "marked"

const marked = new Marked({
  gfm: true,
  breaks: false,
})

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string
}
