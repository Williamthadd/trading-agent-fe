# TradingAgents Web Workstation

A standalone React, Vite, and TypeScript Bloomberg-style workstation for TradingAgents. Firebase Authentication signs users in, Cloud Firestore supplies shared read-only analysis history, and the separate FastAPI process is needed only to start a new analysis.

```text
Firebase Authentication ──> login and remembered session
Cloud Firestore ──────────> history, events, reports, and decisions
FastAPI TradingAgents ────> runtime options and POST new analysis
```

The browser never runs agents, calls Gemini/Ollama directly, or receives a Firebase service account. This workstation and its read-only Firestore history are restricted to the verified Firebase identity `williamthudd@gmail.com` by the rules in this repository.

## Requirements

- A current Node.js LTS release and npm
- JDK 21 or newer for Firebase CLI 15.x Firestore Emulator commands
- A Firebase project with a registered Web App, Authentication, and the default Firestore database
- Internet access to Firebase services, including in `HISTORY ONLY` mode
- Optionally, the separate backend at `W:\AI\Agent\TradingAgents` for launching analyses

## Frontend environment

Install dependencies and create the local environment file:

```powershell
npm install
Copy-Item .env.example .env.local
```

In Firebase Console, open **Project settings > General > Your apps**, select the Web App, and copy its public `firebaseConfig` fields into `.env.local`:

```dotenv
VITE_FIREBASE_API_KEY=your-public-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-web-app-id
VITE_FIREBASE_DATABASE_ID=(default)

# Optional Firebase Web App fields
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MEASUREMENT_ID=

# Needed only to launch an analysis
VITE_TRADINGAGENTS_API_URL=http://127.0.0.1:8000
```

The frontend rejects missing required Firebase values and any database ID other than `(default)`. Firebase Web configuration is public client configuration; it does not grant data access and must never be replaced with a service-account credential.

These identities must refer to the same Firebase project:

```text
VITE_FIREBASE_PROJECT_ID
  == backend FIREBASE_PROJECT_ID
  == project_id in the backend service-account JSON
  == Firebase CLI deployment project
```

The frontend and backend `FIREBASE_DATABASE_ID` values must both be exactly `(default)`. Named-database support requires coordinated SDK, backend, Emulator, Rules, indexes, and deployment changes and is intentionally rejected here.

## Firebase administrator setup

1. In **Authentication > Sign-in method**, enable Google and Email/Password.
2. In **Authentication > Settings > Authorized domains**, add `localhost` for local development. Enter only the domain—no scheme and no port.
3. In **Authentication > Users**, retain or manually create only the `williamthudd@gmail.com` account needed by this workstation. This frontend intentionally has no registration flow.
4. Confirm that `williamthudd@gmail.com` is marked verified. Google identities are normally verified; a manually-created Email/Password identity must also be verified before this app will accept it.
5. To permit analysis launches, independently set `WEB_AUTH_ALLOWED_EMAILS=williamthudd@gmail.com` in the backend environment. Firestore Rules and the backend analysis allowlist are separate gates.

The exact verified owner email is required to read documents in `trading_runs` and their `events` subcollections. The schema has no `owner_uid`; the rules restrict this deployment to one owner identity rather than converting runs to per-document ownership. Browser clients cannot write any run or event, and unrelated collections remain inaccessible.

Another Google account may still complete Firebase's identity-provider handshake before the frontend observer immediately signs it out, but it cannot enter the workstation or read Firestore data. Preventing Firebase from issuing that session at all requires disabling/removing other Firebase Auth users or configuring an Identity Platform Auth blocking function.

Revocation is handled by disabling the Firebase Auth user or changing and deploying the exact-email rule. A separate UID membership document is neither required nor consulted.

## Deploy to Vercel

This repository includes a Vercel SPA configuration and a fail-fast deployment environment check. Follow [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for the dashboard and CLI procedures, required Firebase Web variables, Firebase Authorized Domains setup, and backend CORS configuration.

## Run mode 1: login and history only

FastAPI may remain stopped:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). After Firebase login and a server-authorized history probe, Daily History, archived events, reports, and Final Trading Decisions remain available from Firestore. The workstation shows `HISTORY ONLY` and disables analysis-engine controls.

This mode is backend-offline, not internet-offline. Firebase Authentication and Cloud Firestore must still be reachable. It cannot start agents, call Gemini or Ollama, retrieve current runtime options, or read runs stored only in the backend's local JSON fallback.

## Run mode 2: full analysis

Start the backend in a separate terminal:

```powershell
cd YOUR PATH
conda activate tradingagents
python -m pip install -e ".[api]"
tradingagents-api
```

The backend `.env` needs the frontend origins, Firebase Admin credentials, the same project/database identity, and Firebase storage:

```dotenv
WEB_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
WEB_AUTH_REQUIRED=true
WEB_AUTH_ALLOWED_EMAILS=williamthudd@gmail.com
FIREBASE_ENABLED=true
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CREDENTIALS_PATH=secrets/firebase-service-account.json
FIREBASE_DATABASE_ID=(default)
FIREBASE_COLLECTION=trading_runs
```

Then keep the frontend running:

```powershell
npm run dev
```

The backend still verifies a fresh Firebase ID token before accepting a run. It must report Firebase storage before Launch is enabled. Ollama must also be running when a local model is selected.

If the backend reports local/local-JSON storage, existing Firestore history remains readable but new launches are disabled because local-only runs cannot appear in direct Firestore history. If storage falls back to local JSON during a run, the browser keeps the last confirmed Firestore snapshot without inventing later progress or completion.

## Firestore Rules and indexes

This frontend repository is the sole source of truth for deployed Firestore Rules and indexes:

- `firestore.rules` grants read-only run/event access only when the Firebase token has the exact verified email `williamthudd@gmail.com`; no UID membership document is required.
- `firestore.indexes.json` contains no composite indexes; the daily query uses only `where("date_key", "==", selectedDate)` and sorts client-side.
- `firebase.json` pins the local Firestore Emulator to `127.0.0.1:8080`.

Install the Firebase CLI dependency locally, authenticate, select the exact project, test the rules, and deploy deliberately:

```powershell
npm install
npx firebase login
npx firebase use --add
npm run test:rules
npx firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
```

`npm run test:rules` uses a forced `demo-*` project ID and the local Emulator; test seeding occurs only with Security Rules disabled. The suite proves unauthenticated denial, exact verified-email access without a membership document, rejection of other or unverified emails, read-only enforcement, legacy-collection secrecy, catch-all denial, nested event access, and the production daily query.

Before deployment, verify the Firebase CLI project, frontend project ID, backend project ID, service-account `project_id`, and both `(default)` database IDs again. Never deploy permissive temporary rules to make a demo pass.

## Security notes

- Never place a service-account JSON, private key, Gemini/LLM key, Ollama credential, App Check debug token, or raw ID token in this repository, a `VITE_*` variable, localStorage, screenshots, or browser logs.
- The browser's production Firestore integration is read-only. Trusted Python Admin SDK writes bypass Security Rules and remain governed by server IAM.
- The frontend immediately ejects other accounts as a UX guard, but client code is not the authorization boundary. The exact verified owner email is pinned in Firestore Rules, and the backend separately enforces `WEB_AUTH_ALLOWED_EMAILS`. Never move this policy into Vite configuration or localStorage alone.
- Firestore uses memory-only caching so sensitive reports are not deliberately persisted across browser sessions on shared computers.
- Restrict the public Firebase Web API key to the required Firebase APIs and intended web origins in Google Cloud Console.
- Optional App Check is future defense in depth; do not enable enforcement or commit a debug token without completing Console setup and monitoring.
- Agent Markdown and Firestore content remain untrusted. The renderer mounts no raw HTML or remote Markdown images and activates only credential-free absolute HTTP(S) links.

## Quality checks

```powershell
npm run lint
npm test
npm run test:rules
npm run build
npx playwright install chromium
npm run test:e2e
```

To run the Firestore Emulator interactively:

```powershell
npm run firebase:emulators
```

Preview a production build with `npm run preview`. The preview origin is `http://localhost:4173`; add it to backend CORS when using full-analysis preview mode. Firebase Authorized Domains still use a hostname without a port.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite on port 5173 |
| `npm run build` | Strict TypeScript build and production bundle |
| `npm run build:vercel` | Validate the Vercel environment, then build `dist` |
| `npm run preview` | Serve the production bundle locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit/component tests without requiring emulators |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run Playwright acceptance tests |
| `npm run firebase:emulators` | Start the local Firestore Emulator |
| `npm run test:rules` | Start the Emulator and run Security Rules tests |
| `npm run firebase:deploy:rules` | Deploy this repository's rules to the selected Firebase project |

## Official Firebase references

- [Add Firebase to a web app](https://firebase.google.com/docs/web/setup)
- [Firebase Auth state observer](https://firebase.google.com/docs/auth/web/start)
- [Auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence)
- [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Email/password sign-in](https://firebase.google.com/docs/auth/web/password-auth)
- [Listen to Firestore updates](https://firebase.google.com/docs/firestore/query-data/listen)
- [Security Rules conditions and access calls](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Security Rules are not filters](https://firebase.google.com/docs/firestore/security/rules-query)
- [Test Rules with the Emulator](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [Web cache and persistence behavior](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- [Firestore index management](https://firebase.google.com/docs/firestore/query-data/indexing)
