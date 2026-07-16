# Run 3 local preview

Status: local review runbook
Recorded: 2026-07-13
Production deployment: **not performed**

## Worktree and runtime

Run every command in the isolated Run 3 worktree:

```bash
cd /Users/jonathanholman/Code/Hi-Coworking/hi-coworking-exchange-run-3
git branch --show-current
git rev-parse HEAD
git status --short --branch
```

The expected branch is `codex/exchange-run-3-economic-intelligence`. Use Node
20 and Java 21. Confirm both before running emulators or gates:

```bash
node --version
npm --version
java -version
```

Do not use or stop the existing servers on ports 3000 and 3001; they belong to
other worktrees. Run 3 uses port 3002.

## Local Mapbox configuration

Create `apps/web/.env.local` in the Run 3 worktree. It is ignored by Git. Put a
non-production public Mapbox token in it without printing or committing the
token:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_nonproduction_public_token
```

Confirm presence without emitting the value:

```bash
test -f apps/web/.env.local
grep -Eq '^NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk\..+' apps/web/.env.local
git check-ignore apps/web/.env.local
```

A missing token is safe: Opportunities automatically renders its complete list
fallback and explains that map configuration is absent. Do not claim live
Mapbox coverage unless the token was loaded and the browser actually rendered a
WebGL canvas, controls, attribution, clusters, and selection.

No usable Mapbox token existed in the audited local environment on 2026-07-13.
The committed screenshots therefore identify development demo data and
missing-token list fallback unless later evidence explicitly says otherwise.

## Path A: Firebase emulator demonstration

Install dependencies and build the shared and Functions packages:

```bash
npm ci
npm run build:shared
npm run build:functions
```

Start Auth, Firestore, Functions, and Storage emulators in terminal 1:

```bash
npm run emulators:exchange
```

The command is pinned to the Firebase demo project. In terminal 2, seed the
deterministic synthetic dataset:

```bash
npm run seed:exchange-demo
```

The seed script refuses to run unless:

- `GCLOUD_PROJECT` is exactly `demo-hi-coworking`;
- Firestore is at local port 8081;
- Auth is at local port 9100; and
- both emulator host variables resolve to `localhost` or `127.0.0.1`.

Start the web application in terminal 3:

```bash
npm run dev:exchange
```

Open:

```text
http://localhost:3002/exchange?view=opportunities
http://localhost:3002/exchange?view=connections
http://localhost:3002/exchange?view=intelligence
```

Synthetic emulator accounts all use the local-only password
`Run3-Demo-Only!`:

| Purpose | Email | UID |
| --- | --- | --- |
| Referrer | `referrer@run3.example.test` | `demo-referrer` |
| Recipient/provider | `provider@run3.example.test` | `demo-provider` |
| Workforce partner | `partner@run3.example.test` | `demo-partner` |
| Admin review | `admin@run3.example.test` | `demo-admin` |

These identities are synthetic, exist only in the Auth emulator, and are not
production credentials.

## Path B: development-only visual demo

When emulators are not required, start the in-memory visual review path:

```bash
npm run dev:exchange:demo
```

Then open:

```text
http://localhost:3002/exchange?view=opportunities
```

Use the view controls to review Connections and Intelligence. The page must show
the prominent `Development demo data` banner. The demo gateway uses synthetic
fixtures and in-memory actions only; it does not invoke live Firebase mutation
callables. The mode resolves false in `NODE_ENV=production`, even when the
public flag is set. CI deliberately sets the flag during a production build and
the Run 3 tests independently verify rejection.

## Review scenarios

The seeded and in-memory paths demonstrate:

1. Opportunity list and map when a token exists.
2. Released and scheduled territories.
3. Sent, received, draft, active, converted, closed, and disputed referrals.
4. Responsive referral creation.
5. Explainable recipient suggestions.
6. Accepted immutable offer and fee terms.
7. A PII-minimized append-only timeline.
8. Converted no-compensation and compensated referrals.
9. A 100-basis-point fee on the gross referral payout.
10. `Calculation complete — platform settlement is not yet enabled.`
11. Explainable relationship state and sample size.
12. Industry and territory gaps.
13. Neutral reciprocal-pattern context.
14. Reported versus confirmed, currency-specific economic metrics.
15. RFx and team links backed by current authority.
16. Mobile filters, details, creation, and intelligence layouts.

## Responsive QA dimensions

Review the real Run 3 page at:

```text
1440 × 900
1024 × 768
390 × 844
```

At each size verify view switching, Back/Forward restoration, keyboard focus,
Escape close, trigger-focus restoration, readable long content, no horizontal
overflow, no nested-scroll trap, approximately 44-pixel mobile targets, and the
demo-data label. Screenshots belong in
`docs/exchange/screenshots/run-3/` and must contain synthetic data only.

## Stop services

Stop each Run 3 foreground process with `Ctrl-C` in its own terminal. Confirm
only Run 3 ports are gone:

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
lsof -nP -iTCP:5004 -sTCP:LISTEN
lsof -nP -iTCP:8081 -sTCP:LISTEN
lsof -nP -iTCP:9100 -sTCP:LISTEN
lsof -nP -iTCP:9199 -sTCP:LISTEN
```

Do not kill listeners on 3000 or 3001.

## Diagnose a mismatched preview

If the page appears to be an older run, inspect the listener and its working
directory:

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
ps -o pid=,command= -p "$(lsof -tiTCP:3002 -sTCP:LISTEN)"
pwd
git branch --show-current
git rev-parse --short HEAD
```

If 3002 is occupied by an unrelated process, do not stop it without identifying
its owner. Start Run 3 on another free port and record the deviation.

If the emulator seed refuses to run, verify the configured ports from
`firebase.json`, verify the project ID is `demo-hi-coworking`, and restart the
emulators. Never weaken the seed guard or substitute the production project.

If Mapbox falls back to the list, verify that `apps/web/.env.local` belongs to
this worktree, that the key begins with `pk.`, and that the web server was
restarted after the file changed. Never paste the token into logs or committed
documentation.
