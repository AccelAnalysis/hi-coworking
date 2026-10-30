/**
 * Hi Coworking mark. Raster PNG today (the supplied master is 866 x 834; no
 * vector master exists yet). To switch to an SVG later, change SOURCES only.
 *
 * - "navy": navy bubble with a white "Hi", for white or light backgrounds.
 * - "inverse": white bubble with a navy "Hi", for Hi Navy backgrounds.
 *   Never place the navy mark on a white plate on a dark background.
 */
export type HiLogoVariant = "navy" | "inverse";

const SOURCES: Record<HiLogoVariant, { small: string; large: string }> = {
  navy: {
    small: "/brand/hi-coworking/hi-coworking-mark-256.png",
    large: "/brand/hi-coworking/hi-coworking-mark-512.png",
  },
  inverse: {
    small: "/brand/hi-coworking/hi-coworking-mark-inverse-256.png",
    large: "/brand/hi-coworking/hi-coworking-mark-inverse-512.png",
  },
};

// Master aspect ratio (866 x 834).
const ASPECT = 834 / 866;

export function HiLogo({
  variant = "navy",
  width = 96,
  className,
  decorative = false,
}: {
  variant?: HiLogoVariant;
  width?: number;
  className?: string;
  decorative?: boolean;
}) {
  const source = SOURCES[variant];
  return (
    // Static export with unoptimized images; a plain img keeps it simple (see AccelWordmark).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={width > 128 ? source.large : source.small}
      srcSet={`${source.small} 256w, ${source.large} 512w`}
      sizes={`${width}px`}
      width={width}
      height={Math.round(width * ASPECT)}
      alt={decorative ? "" : "Hi Coworking"}
      aria-hidden={decorative ? true : undefined}
      className={className}
      draggable={false}
    />
  );
}
