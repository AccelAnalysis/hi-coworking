# Hi Coworking typography

Approved direction: Fraunces + DM Sans (October 24, 2026).

| Application | Typeface | Weight |
| --- | --- | --- |
| Hero and major marketing section headings | Fraunces | 600 |
| Body copy | DM Sans | 400 |
| Navigation and buttons | DM Sans | 500 |
| Labels and pricing | DM Sans | 500–700 |
| Booking, account, staff and admin interfaces | DM Sans | 400–700 |
| Existing live-text logo | Geist (preserved) | Existing weights |

DM Sans is the global default and Tailwind `font-sans` family. Use `font-display font-semibold` explicitly on marketing headlines; do not apply a global h1/h2 serif rule. Transaction headings, error messages, compact card titles, prices, forms and controls stay in DM Sans. Use `font-logo` for the existing wordmark. Monospaced codes retain Geist Mono. Accel Analysis and Power Now retain their separate brand styles.

Fonts are loaded through next/font/google and served with the application. Fraunces is limited to weight 600; DM Sans retains its variable range for existing UI weights. Both use swap rendering and system fallback families.

For future signage, marketing materials and presentations, use the same pairing and roles. Keep the logo artwork intact. Use comfortable line spacing, preserve contrast and allow headings to wrap naturally. Avoid fixed-height text containers and excessive negative tracking.

Before release, review home, about, pricing, contact, events and bookstore at mobile and desktop widths; check booking, account and admin controls and 200% zoom. Verify downloaded fonts and computed families, plus logo preservation. A successful build alone does not establish visual acceptance.
