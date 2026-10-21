import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { BarcodeFormat, BinaryBitmap, Code128Reader, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library'

const load = async (path, replacements = []) => {
  let source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  return { module: await import(url), url }
}
const barcode = await load('src/lib/barcode.ts')
assert.deepEqual(barcode.module.barcodeLookupValues(' 036000291452 '), ['036000291452', '0036000291452'])
assert.deepEqual(barcode.module.barcodeLookupValues('0036000291452'), ['0036000291452', '036000291452'])
assert.equal(barcode.module.normalizeBarcode('00001-A B'), '00001-A B')
for (const invalid of ['', ' '.repeat(3), 'a'.repeat(129), 'ABC\nDEF']) assert.throws(() => barcode.module.normalizeBarcode(invalid))

const { buildMaterialMovement } = (await load('src/lib/materialMovement.ts')).module
const material = { id: 'm', unit: 'm²', unit_price: 8, quantity_available: 10.125 }
const draft = { material_id: 'm', movement_type: 'carico', quantity: 2, unit_cost: 8, occurred_on: '2026-10-21', job_id: '', recovered_item_id: '', supplier_id: '', notes: '' }
assert.equal(buildMaterialMovement(draft, material, []).resultingStock, 12.125)
assert.equal(buildMaterialMovement({ ...draft, movement_type: 'scarico', quantity: 0.125 }, material, []).resultingStock, 10)
const linked = buildMaterialMovement({ ...draft, movement_type: 'consumo_recupero', recovered_item_id: 'r' }, material, [{ id: 'r', job_id: 'j' }])
assert.equal(linked.payload.movement_type, 'consumo_commessa')
assert.equal(linked.payload.job_id, 'j')
assert.equal(linked.payload.recovered_item_id, 'r')
assert.equal(linked.payload.unit_cost_snapshot, 8)
assert.equal('user_id' in linked.payload, false)
assert.equal(buildMaterialMovement({ ...draft, movement_type: 'consumo_recupero', recovered_item_id: 'r' }, material, [{ id: 'r', job_id: null }]).payload.movement_type, 'consumo_recupero')
for (const quantity of [0, -1, NaN, Infinity, 1.0001]) assert.throws(() => buildMaterialMovement({ ...draft, quantity }, material, []))
assert.throws(() => buildMaterialMovement({ ...draft, movement_type: 'scarico', quantity: 11 }, material, []), /giacenza/)
assert.throws(() => buildMaterialMovement({ ...draft, movement_type: 'consumo_commessa' }, material, []), /commessa/)
assert.throws(() => buildMaterialMovement({ ...draft, movement_type: 'consumo_recupero', recovered_item_id: 'foreign' }, material, []), /recupero/)

// Decode real raster fixtures with the same ZXing engine used on Safari.
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
const G = L.map((pattern) => [...pattern].reverse().map((bit) => bit === '0' ? '1' : '0').join(''))
const R = L.map((pattern) => pattern.replace(/[01]/g, (bit) => bit === '0' ? '1' : '0'))
const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
function ean13(value) {
  return '101' + [...value.slice(1, 7)].map((n, i) => (parity[+value[0]][i] === 'L' ? L : G)[+n]).join('') + '01010' + [...value.slice(7)].map((n) => R[+n]).join('') + '101'
}
function ean8(value) { return '101' + [...value.slice(0,4)].map((n) => L[+n]).join('') + '01010' + [...value.slice(4)].map((n) => R[+n]).join('') + '101' }
function code128(value) {
  const codes = [104, ...[...value].map((c) => c.charCodeAt(0) - 32)]
  codes.push(codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103, 106)
  return codes.flatMap((code) => Array.from(Code128Reader.CODE_PATTERNS[code], (width, index) => (index % 2 ? '0' : '1').repeat(width))).join('')
}
const reader = new MultiFormatReader()
reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]]]))
for (const [value, bits, expected] of [
  ['4006381333931', ean13('4006381333931'), '4006381333931'],
  ['96385074', ean8('96385074'), '96385074'],
  ['036000291452', ean13('0036000291452'), '036000291452'],
  ['LuLab-128', code128('LuLab-128'), 'LuLab-128']
]) {
  const row = '0'.repeat(20) + bits + '0'.repeat(20)
  const width = row.length * 3, height = 100
  const pixels = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = row[Math.floor(x / 3)] === '1' ? 0 : 255
  try {
    assert.equal(reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height)))).getText(), expected, value)
  } catch (cause) { throw new Error(`Decodifica fixture fallita: ${value}`, { cause }) }
}

// Camera lifecycle: cancel a pending permission, accept just one read, release
// every track, and handle a denied permission without leaving the camera alive.
const { startBarcodeCamera } = (await load('src/lib/barcodeCamera.ts', [["'./barcode'", JSON.stringify(barcode.url)]])).module
let resolvePermission
let stopped = 0, reads = 0, errors = 0
const stream = { getTracks: () => [{ stop: () => stopped++ }] }
const video = { play: async () => {}, pause() {}, srcObject: null, readyState: 4 }
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve }) } } })
const cancel = startBarcodeCamera(video, () => reads++, () => errors++, () => {})
cancel(); resolvePermission(stream)
await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(stopped, 1); assert.equal(reads, 0)
globalThis.navigator.mediaDevices.getUserMedia = async () => stream
globalThis.BarcodeDetector = class {
  static async getSupportedFormats() { return ['ean_13','ean_8','upc_a','upc_e','code_128'] }
  async detect() { return [{ rawValue: '4006381333931' }, { rawValue: '4006381333931' }] }
}
startBarcodeCamera(video, () => reads++, () => errors++, () => {})
await new Promise((resolve) => setTimeout(resolve, 30))
assert.equal(reads, 1); assert.equal(video.srcObject, null); assert.equal(stopped, 2)
globalThis.navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError') }
startBarcodeCamera(video, () => reads++, () => errors++, () => {})
await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(errors, 1); assert.equal(reads, 1)
console.log('Barcode: EAN-13, EAN-8, UPC-A e Code 128 decodificati; lifecycle camera, cancellazione, lettura singola e payload movimenti: OK')
