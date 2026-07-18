# Hi Exchange Mapbox setup

The Exchange uses Mapbox GL JS with Mapbox Standard when a public browser token is configured. Leaflet/OpenStreetMap remains a development fallback, but Mapbox is the intended production provider and enables the 2D/3D control.

## Local development

From the repository root:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local` and replace the placeholder with a Mapbox **public** token:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.replace-with-your-public-token
```

Never put an `sk.` secret token in a browser environment variable. The local file is ignored by Git and must not be committed.

Restart the Next.js development server after creating or changing the file:

```bash
rm -rf apps/web/.next
npm run dev
```

## Token restrictions

Create a dedicated token for the Exchange rather than reusing a broad account token. Enable the public scopes needed by Mapbox GL JS and restrict allowed URLs for each environment.

For local development, include the actual origins used during testing, for example:

- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:3002`

For staging and production, create separate tokens and add only the corresponding deployed hostnames.

## Verification

Open `/exchange` and inspect the map element. A configured Mapbox surface has:

```text
data-map-provider="mapbox"
```

The upper-right control switches between 2D and 3D. The 3D state enables Mapbox Standard 3D objects and applies a pitched, rotated camera. Record markers still require verified coordinates in the underlying Exchange data.
