# Authoritative locality boundaries

## Configured development boundary

The configured launch locality is Isle of Wight County, Virginia, county FIPS
`51093`. The only accepted development boundary is the U.S. Census Bureau
TIGERweb `State_County` Counties layer, layer `7`, described by Census as the
January 1, 2025 vintage. The importer checks the layer identifier, publisher,
vintage, required fields, exact state/county/GEOID tuple, and exact county name
before it will construct a Firestore record.

The source endpoints are:

- metadata: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/7?f=json`
- GeoJSON query: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/7/query?where=GEOID%3D%2751093%27&outFields=GEOID%2CNAME%2CBASENAME%2CSTATE%2CCOUNTY%2CCENTLAT%2CCENTLON%2CINTPTLAT%2CINTPTLON&returnGeometry=true&outSR=4326&f=geojson`
- technical documentation: `https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc.pdf`

The query returns one Polygon in EPSG:4326 with 1,993 positions. The importer
records both the official Census `CENTLAT`/`CENTLON` centroid and
`INTPTLAT`/`INTPTLON` internal point, validates both against coordinate bounds
and the returned geometry bounds, and stores independent SHA-256 hashes for the
geometry and full authoritative source input.

Recorded configured-development evidence on 2026-07-22:

- authoritative input size: 77,923 bytes;
- authoritative source SHA-256:
  `4c936a72a4228fa037286b89630de2ecca9c2ef14105808f1c00d9e1d5f80b57`;
- normalized geometry SHA-256:
  `08bb1381c304468a5b41acc0114fd8e406b67d866b471cd4ed70d4aa15bbaf5f`;
- official Census centroid: `36.9066329, -76.7093003`;
- official internal point: `36.9014184, -76.7075688`; and
- live document: `territories/51093`, status `released`.

No rectangle, hand-drawn polygon, geocoder approximation, or organization
coordinate is created. Organizations without independently reviewed and
publication-approved coordinates remain list-only. A county centroid is never
presented as an organization's location.

## Import guard

The importer is dry-run by default and permits a non-emulator write only when:

1. the project is exactly `hi-coworking-plat`;
2. the environment is exactly `development`;
3. `--apply` is present;
4. `--confirm-development hi-coworking-plat` is present;
5. a protected rollback path is supplied;
6. the Census metadata and feature checks pass;
7. an existing non-Census territory would not be overwritten.

Run the source and live-state plan:

```bash
npm run territory:isle-of-wight:dry
```

Apply only after reviewing the plan:

```bash
npm run territory:isle-of-wight:apply
```

The apply writes the rollback file with exclusive-create semantics, mode
`0600`, before writing Firestore. The containing ignored directory is mode
`0700`. A second apply is content-aware; an unchanged source/status produces no
write.

Verify replay explicitly:

```bash
npm run territory:isle-of-wight:replay
```

The configured apply completed after protected rollback creation. The explicit
replay returned `noOp: true` and `writes: 0`; the live territory remained
released.

## Rollback

The rollback manifest records whether the territory existed, the full prior
snapshot when it did, and the exact post-import snapshot hash. Rehearsal is
read-only:

```bash
npm run territory:isle-of-wight:rollback:rehearse
```

An actual development rollback requires the same explicit project confirmation:

```bash
node apps/functions/scripts/import-authoritative-territory.cjs \
  --project hi-coworking-plat \
  --environment development \
  --rollback data/seed/prepared/territory/rollback-51093.json \
  --apply \
  --confirm-development hi-coworking-plat
```

Rollback refuses if the live territory no longer matches the protected
post-import hash. This prevents a stale package from erasing a subsequent
administrative or source update.

The configured read-only rehearsal returned `ready: true`, planned action
`delete` (because the territory did not exist before this workstream), and
`applied: false`. No rollback was executed, so the authoritative territory
remains live. The protected ignored rollback artifact is
`data/seed/prepared/territory/rollback-51093.json`.

## Validation

`apps/functions/test/authoritative-territory-import.test.cjs` covers source
identity and vintage pinning, exact FIPS/name validation, Polygon ring and
coordinate checks, configured-project guards, no-op replay, existing-record
protection, rollback rehearsal, rollback restoration, and changed-record
refusal. Six focused importer tests passed, followed by the configured apply,
no-op replay, and read-only rollback rehearsal above.
