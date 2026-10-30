/** The SFA mark: three rounded squares and a lime diamond. */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="SFA">
      <g fill="#fafafa">
        <rect x="3" y="3" width="11.5" height="11.5" rx="2.75" />
        <rect x="17.5" y="3" width="11.5" height="11.5" rx="2.75" />
        <rect x="3" y="17.5" width="11.5" height="11.5" rx="2.75" />
      </g>
      <rect x="18.25" y="18.25" width="10.5" height="10.5" rx="2" transform="rotate(45 23.5 23.5)" fill="#C6FF3D" />
    </svg>
  )
}
