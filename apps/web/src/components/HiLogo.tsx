/**
 * Hi Coworking mark (approved Oct 30, 2026): the navy speech bubble on light
 * backgrounds, the inverse (white bubble, navy "Hi") on navy or dark
 * backgrounds. Never on a white plate.
 */
export function HiLogo({
  tone = "light",
  size = 32,
  withWordmark = true,
  className = "",
}: {
  /** Background the logo sits on. */
  tone?: "light" | "dark";
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  const src = tone === "dark"
    ? "/brand/hi-coworking/hi-coworking-mark-inverse.svg"
    : "/brand/hi-coworking/hi-coworking-mark.svg";
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark, export build */}
      <img
        src={src}
        width={size}
        height={Math.round((size * 834) / 866)}
        alt={withWordmark ? "" : "Hi Coworking"}
        aria-hidden={withWordmark ? true : undefined}
        className="block"
      />
      {withWordmark ? (
        <span className={`font-sans text-xl font-bold tracking-tight ${tone === "dark" ? "text-white" : "text-[#101D4B]"}`}>
          <span className="sr-only">Hi </span>Coworking
        </span>
      ) : null}
    </span>
  );
}
