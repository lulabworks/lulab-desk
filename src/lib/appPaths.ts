const baseUrl = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

export const APP_BASE_URL = baseUrl
export const ROUTER_BASENAME = baseUrl === '/' ? '/' : baseUrl.slice(0, -1)

export function appPath(path = '') {
  return `${baseUrl}${path.replace(/^\/+/, '')}`
}

export function absoluteAppUrl(path = '') {
  return new URL(appPath(path), window.location.origin).toString()
}

export function isAppPath(path: string) {
  return window.location.pathname === appPath(path)
}
