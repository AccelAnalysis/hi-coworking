/**
 * Playfair Display for headlines and Open Sans for UI.
 * Loaded from Google Fonts so the static export does not depend on next/font.
 * Georgia and Arial are the brand fallbacks when the stylesheet has not arrived.
 */
export function AccelBrandFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-dvh [font-family:var(--font-aa-body),Arial,sans-serif]"
      style={{
        ["--font-aa-display" as string]: '"Playfair Display", Georgia, serif',
        ["--font-aa-body" as string]: '"Open Sans", Arial, sans-serif',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&family=Playfair+Display:wght@400;700&display=swap"
      />
      {children}
    </div>
  );
}
