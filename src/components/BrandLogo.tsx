import { BRAND } from '../lib/brand'

export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <img
      src={BRAND.logo}
      alt={`Logo ${BRAND.name}`}
      className={`shrink-0 bg-white object-contain ${className}`}
      width="1024"
      height="1024"
    />
  )
}
