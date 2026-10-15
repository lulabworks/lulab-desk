import { readableError, supabase } from './supabase'

export interface PushPreferences {
  site_inquiries_enabled: boolean
  appointments_enabled: boolean
  job_deliveries_enabled: boolean
  quotes_enabled: boolean
  appointment_days_before: number
  appointment_hour: number
  delivery_days_before: number
  delivery_hour: number
  quote_days_after: number
  quote_hour: number
}

export const defaultPushPreferences: PushPreferences = {
  site_inquiries_enabled: true,
  appointments_enabled: true,
  job_deliveries_enabled: true,
  quotes_enabled: true,
  appointment_days_before: 1,
  appointment_hour: 18,
  delivery_days_before: 2,
  delivery_hour: 9,
  quote_days_after: 7,
  quote_hour: 10
}

export type PushDeviceStatus = 'active' | 'disabled' | 'blocked' | 'unsupported' | 'install_required' | 'other_account'

export function getPushDeviceStatus(): PushDeviceStatus {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (isIos && !isInstalled) return 'install_required'
  if (Notification.permission === 'denied') return 'blocked'
  return 'disabled'
}

export async function readPushDeviceStatus(): Promise<PushDeviceStatus> {
  const status = getPushDeviceStatus()
  if (status !== 'disabled') return status
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription || Notification.permission !== 'granted' || !supabase) return 'disabled'
    const { data, error } = await supabase.functions.invoke('manage-push-subscription', { body: { action: 'status', endpoint: subscription.endpoint } })
    if (error) return 'disabled'
    if (data?.registered_elsewhere) return 'other_account'
    return data?.registered ? 'active' : 'disabled'
  } catch { return 'disabled' }
}

function applicationServerKey(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function saveSubscription(action: 'register' | 'remove', subscription: PushSubscription) {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const serialized = subscription.toJSON()
  const { data, error } = await supabase.functions.invoke('manage-push-subscription', {
    body: { action, endpoint: subscription.endpoint, keys: serialized.keys }
  })
  if (error) {
    if (typeof data?.error === 'string') throw new Error(data.error)
    const context = (error as Error & { context?: Response }).context
    if (context instanceof Response) {
      let responseBody: { error?: unknown } | null = null
      try {
        responseBody = await context.clone().json() as { error?: unknown }
      } catch { /* usa il messaggio standard dell'SDK se la risposta non è JSON */ }
      if (typeof responseBody?.error === 'string') throw new Error(responseBody.error)
    }
    throw new Error(readableError(error))
  }
  if (data?.error) throw new Error(String(data.error))
}

export async function enablePushNotifications(): Promise<void> {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const initial = getPushDeviceStatus()
  if (initial === 'unsupported' || initial === 'install_required') throw new Error(initial === 'install_required' ? 'Su iPhone installa prima LuLab Desk nella schermata Home.' : 'Questo dispositivo o browser non supporta Web Push.')
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) throw new Error('Manca la chiave pubblica VAPID nella configurazione locale del frontend.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Le notifiche sono bloccate nelle impostazioni del browser.' : 'Non è stata concessa l’autorizzazione alle notifiche.')
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(import.meta.env.VITE_VAPID_PUBLIC_KEY) })
  await saveSubscription('register', subscription)
}

export async function disablePushNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await saveSubscription('remove', subscription)
  await subscription.unsubscribe()
}
