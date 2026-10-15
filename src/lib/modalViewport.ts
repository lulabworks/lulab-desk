export type ModalViewport = { top: number; left: number; width: number; height: number }

export function modalViewportSnapshot(viewport: Pick<VisualViewport, 'offsetTop' | 'offsetLeft' | 'width' | 'height'> | null | undefined, layout: { width: number; height: number }): ModalViewport {
  const dimension = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
  const offset = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0
  return { top: offset(viewport?.offsetTop), left: offset(viewport?.offsetLeft), width: dimension(viewport?.width, layout.width), height: dimension(viewport?.height, layout.height) }
}

export function modalFieldScrollDelta(field: { top: number; bottom: number }, region: { top: number; bottom: number }, padding = 12): number {
  if (field.bottom - field.top > region.bottom - region.top - padding * 2 || field.top < region.top + padding) return field.top - region.top - padding
  return field.bottom > region.bottom - padding ? field.bottom - region.bottom + padding : 0
}
