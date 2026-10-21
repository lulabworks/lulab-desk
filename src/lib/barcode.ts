export function normalizeBarcode(value: string) {
  const barcode = value.trim()
  if (!/^[\x20-\x7e]{1,128}$/.test(barcode)) {
    throw new Error('Inserisci un codice a barre di massimo 128 caratteri, senza caratteri speciali non stampabili.')
  }
  return barcode
}

// UPC-A may be reported by a reader as EAN-13 with a leading zero. Keep the
// original text (including zeros) and look up both equivalent representations.
export function barcodeLookupValues(value: string) {
  const barcode = normalizeBarcode(value)
  if (/^\d{12}$/.test(barcode)) return [barcode, `0${barcode}`]
  if (/^0\d{12}$/.test(barcode)) return [barcode, barcode.slice(1)]
  return [barcode]
}
