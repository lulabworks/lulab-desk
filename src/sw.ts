/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> }

precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
clientsClaim()
void self.skipWaiting()

self.addEventListener('push', (event) => {
  const payload = (() => {
    try { return event.data?.json() as { title?: string; body?: string; path?: string; tag?: string } }
    catch { return null }
  })()
  if (!payload || !payload.title || !payload.body || !payload.path?.startsWith('/') || payload.path.startsWith('//')) return
  const scopeUrl = new URL(self.registration.scope)
  const target = new URL(payload.path.replace(/^\/+/, ''), scopeUrl)
  if (target.origin !== scopeUrl.origin || !target.pathname.startsWith(scopeUrl.pathname)) return
  const icon = new URL('icons/pwa-192x192.png', scopeUrl).toString()
  const options = {
    body: payload.body,
    icon,
    badge: icon,
    tag: payload.tag,
    data: { target: target.toString() },
    renotify: false
  } as NotificationOptions & { renotify: boolean }
  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetValue = (event.notification.data as { target?: unknown } | undefined)?.target
  if (typeof targetValue !== 'string') return
  const scopeUrl = new URL(self.registration.scope)
  const target = new URL(targetValue)
  if (target.origin !== scopeUrl.origin || !target.pathname.startsWith(scopeUrl.pathname)) return
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      const windowClient = client as WindowClient
      if ('navigate' in windowClient) {
        await windowClient.navigate(target.toString())
        return windowClient.focus()
      }
    }
    return self.clients.openWindow(target.toString())
  })())
})
