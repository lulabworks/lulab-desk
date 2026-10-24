import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { flushSync } from 'react-dom'

/** A transient editing buffer: empty/incomplete keystrokes never reach the form. */
export function NumericInput({ value, defaultValue, onChange, onFocus, onBlur, onKeyDown, readOnly, disabled, inputMode, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const editing = useRef(false)
  const original = useRef('')
  const lastChange = useRef<ChangeEvent<HTMLInputElement> | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '')
  const current = value ?? uncontrolled

  function finish() {
    const input = inputRef.current
    if (!input || !editing.current) return
    // Leave invalid native number input visible so required/min/max/step validation still applies.
    if (input.validity.badInput) return
    editing.current = false
    const next = input.value === '' ? original.current : input.value
    input.value = next
    setDraft(null)
    if (next !== original.current && (original.current === '' || Number(next) !== Number(original.current))) {
      setUncontrolled(next)
      if (lastChange.current) onChange?.(Object.assign(Object.create(lastChange.current), { target: input, currentTarget: input }))
    }
    lastChange.current = null
  }

  // Safari may activate a button without blurring the input. Commit before its click handler reads the form.
  useEffect(() => {
    if (draft === null) return
    function acceptOutside(event: PointerEvent) {
      const input = inputRef.current
      if (!input || event.target === input) return
      flushSync(finish)
    }
    document.addEventListener('pointerdown', acceptOutside, true)
    return () => document.removeEventListener('pointerdown', acceptOutside, true)
  })

  return <input {...props} ref={inputRef} type="number" readOnly={readOnly} disabled={disabled}
    inputMode={inputMode ?? (props.step === undefined || props.step === '1' || props.step === 1 ? 'numeric' : 'decimal')}
    value={draft ?? current}
    onFocus={event => {
      if (!readOnly && !disabled) {
        original.current = event.currentTarget.value
        lastChange.current = null
        editing.current = true
        setDraft('')
      }
      onFocus?.(event)
    }}
    onChange={event => {
      if (!editing.current) { original.current = String(current); editing.current = true }
      lastChange.current = event
      setDraft(event.currentTarget.value)
    }}
    onBlur={event => { finish(); onBlur?.(event) }}
    onKeyDown={event => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key === 'Enter') flushSync(finish)
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && editing.current && event.currentTarget.value === '' && original.current !== '') {
        event.currentTarget.value = original.current
        setDraft(original.current)
      }
      if (event.key === 'Escape') {
        editing.current = false
        event.currentTarget.value = original.current
        setDraft(null)
      }
    }} />
}
