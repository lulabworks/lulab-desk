import { normalizeBarcode } from './barcode'

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
interface Detector { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> }
interface DetectorConstructor {
  new(options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

export function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Accesso alla fotocamera negato. Abilitalo nelle impostazioni del sito oppure inserisci il codice manualmente.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nessuna fotocamera disponibile. Puoi inserire il codice manualmente.'
  if (name === 'NotReadableError') return 'La fotocamera è occupata da un’altra app. Chiudila e riprova oppure inserisci il codice manualmente.'
  if (name === 'NotSupportedError') return 'La fotocamera richiede HTTPS e un browser compatibile. Puoi inserire il codice manualmente.'
  return 'Non è stato possibile avviare la scansione. Riprova oppure inserisci il codice manualmente.'
}

// Returns cancellation immediately, including while the iOS permission prompt
// is still pending. A stream granted after cancellation is stopped at once.
export function startBarcodeCamera(video: HTMLVideoElement, onCode: (code: string) => void, onError: (error: unknown) => void, onReady: () => void) {
  let stopped = false
  let stream: MediaStream | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let decoder: { stop(): void } | undefined
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    decoder?.stop()
    stream?.getTracks().forEach((track) => track.stop())
    video.pause()
    video.srcObject = null
  }
  const finish = (value: string) => {
    if (stopped) return
    let code: string
    try { code = normalizeBarcode(value) } catch { return }
    stop()
    onCode(code)
  }
  const fallback = async () => {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import('@zxing/browser'), import('@zxing/library')
    ])
    if (stopped) return
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]]])
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 500 })
    decoder = reader.scan(video, (result) => { if (result) finish(result.getText()) }, (error) => {
      if (error && !stopped) { stop(); onError(error) }
    })
    if (stopped) decoder.stop()
  }
  void (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Camera unavailable', 'NotSupportedError')
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      if (stopped) { stream.getTracks().forEach((track) => track.stop()); return }
      video.srcObject = stream
      await video.play()
      if (stopped) return
      onReady()
      const NativeDetector = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
      let detector: Detector | undefined
      try {
        const supported = await NativeDetector?.getSupportedFormats()
        if (NativeDetector && supported && FORMATS.every((format) => supported.includes(format))) detector = new NativeDetector({ formats: FORMATS })
      } catch { /* Partial/experimental native support falls back to ZXing. */ }
      if (stopped) return
      if (!detector) { await fallback(); return }
      const readFrame = async () => {
        if (stopped) return
        try {
          if (video.readyState >= 2) {
            const results = await detector!.detect(video)
            if (!stopped && results.length) finish(results[0].rawValue)
          }
          if (!stopped) timer = setTimeout(() => void readFrame(), 180)
        } catch {
          if (!stopped) {
            try { await fallback() } catch (error) { if (!stopped) { stop(); onError(error) } }
          }
        }
      }
      void readFrame()
    } catch (error) {
      if (!stopped) { stop(); onError(error) }
    }
  })()
  return stop
}
