export interface GhUser {
  login: string
  avatar_url: string
}

export function getToken(): string {
  if (typeof window === "undefined") return ""
  return sessionStorage.getItem("gh-token") ?? ""
}

export function getUser(): GhUser | null {
  if (typeof window === "undefined") return null
  try {
    return JSON.parse(sessionStorage.getItem("gh-user") || "null")
  } catch {
    return null
  }
}

export function startLogin(clientId: string) {
  const state = crypto.randomUUID()
  sessionStorage.setItem("gh-oauth-state", state)
  sessionStorage.setItem("gh-oauth-return", window.location.href)

  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set(
    "redirect_uri",
    `${window.location.origin}/auth/callback`,
  )
  url.searchParams.set("state", state)
  window.location.href = url.toString()
}

export function logout() {
  sessionStorage.removeItem("gh-token")
  sessionStorage.removeItem("gh-user")
  window.location.reload()
}

export function initAuthHeader() {
  const slot = document.getElementById("header-user-slot")
  if (!slot) return
  const clientId = slot.dataset.clientId ?? ""
  const token = getToken()
  const user = getUser()

  slot.innerHTML = ""

  if (token && user) {
    const wrap = document.createElement("div")
    wrap.className = "flex items-center gap-3"

    const editLink = currentEditLink()
    if (editLink) {
      const a = document.createElement("a")
      a.href = editLink
      a.textContent = "Edit"
      a.className =
        "bg-white/15 hover:bg-white/25 px-3 py-1 rounded text-sm font-medium"
      wrap.appendChild(a)

      const addLink = document.createElement("a")
      const addHref =
        editLink === "/edit"
          ? "/edit/_new"
          : editLink + "/_new"
      addLink.href = addHref
      addLink.textContent = "+ Add page"
      addLink.className =
        "bg-white/15 hover:bg-white/25 px-3 py-1 rounded text-sm font-medium"
      wrap.appendChild(addLink)
    }

    const review = document.createElement("a")
    review.href = "/review"
    review.textContent = "Review"
    review.className =
      "bg-white/15 hover:bg-white/25 px-3 py-1 rounded text-sm font-medium"
    wrap.appendChild(review)

    if (user.avatar_url) {
      const img = document.createElement("img")
      img.src = user.avatar_url
      img.alt = user.login
      img.className = "w-8 h-8 rounded-full"
      img.title = `${user.login} — click to logout`
      img.style.cursor = "pointer"
      img.addEventListener("click", logout)
      wrap.appendChild(img)
    }

    slot.appendChild(wrap)
  } else if (clientId) {
    const btn = document.createElement("button")
    btn.textContent = "Log in with GitHub"
    btn.className =
      "bg-white/15 hover:bg-white/25 px-3 py-1 rounded text-sm font-medium"
    btn.addEventListener("click", () => startLogin(clientId))
    slot.appendChild(btn)
  }
}

function currentEditLink(): string | null {
  const p = window.location.pathname
  if (p.startsWith("/edit/") || p.startsWith("/review") || p.startsWith("/auth"))
    return null
  if (p === "/") return "/edit"
  return "/edit" + p
}
