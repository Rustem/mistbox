/**
 * The Mistbox emblem: an arch frame containing two peaks, a fir and a
 * shoreline, drawn in a single thin gold line. `variant="fir"` renders the
 * secondary mark — the fir alone — used the way the seal uses it.
 */
export function Emblem({
  size = 96,
  variant = 'full',
  className,
}: {
  size?: number;
  variant?: 'full' | 'fir';
  className?: string;
}) {
  if (variant === 'fir') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 60 60"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 10 L23 24 h4.5 L21 36 h6 L30 30 l3 6h6 L32.5 24H37 Z" />
          <path d="M30 36 v12" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size * 1.28}
      viewBox="0 0 100 128"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        {/* arch frame */}
        <path d="M6 122 V50 A44 44 0 0 1 94 50 V122" />
        <path d="M6 122 H94" />
        {/* two peaks */}
        <path d="M18 96 L38 58 L52 82 L62 68 L82 96" />
        {/* fir, standing left of centre */}
        <path d="M34 104 L28 90 h3.5 L26 79 h5 L34 73 l3 6h5 L36.5 90H40 Z" />
        <path d="M34 104 v6" />
        {/* shoreline */}
        <path d="M14 110 H82" strokeDasharray="10 6" />
      </g>
    </svg>
  );
}
