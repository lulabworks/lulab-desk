import type { Transition } from 'motion/react'

export const routeSpring: Transition = {
  type: 'spring',
  stiffness: 410,
  damping: 38,
  mass: 0.72
}

export const sharedElementSpring: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 34
}

export const listSpring: Transition = {
  type: 'spring',
  stiffness: 430,
  damping: 36
}

export const tapSpring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34
}

export const navIndicatorSpring: Transition = {
  type: 'spring',
  stiffness: 440,
  damping: 34,
  mass: 0.7
}

export const sheetSpring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 38,
  mass: 0.82
}
