/** MARS-X mark: a ridge line over a sun/target dot. Original artwork, not a NASA/JPL mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-rail" />
      <path d="M5 23l7-9.5 4.2 5.2 3.3-4.2L27 23z" className="fill-sidebar-primary" />
      <circle cx="23" cy="9" r="2.8" className="fill-brand" />
    </svg>
  )
}
