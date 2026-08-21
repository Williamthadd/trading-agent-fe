# Deploy TradingAgents Workstation to Vercel

This frontend is a static Vite application. Vercel builds `dist` and serves it from its CDN; Firebase Authentication and Firestore continue to run directly in the browser. No Firebase service-account file belongs in this repository or in Vercel.

## 1. Decide the deployment mode

- **History only:** Firebase login, archive, reports, and decisions work. Leave `VITE_TRADINGAGENTS_API_URL` unset.
- **Full analysis:** deploy the FastAPI TradingAgents backend to a public HTTPS origin first, then set `VITE_TRADINGAGENTS_API_URL` to that origin. A Vercel page cannot use `127.0.0.1`, `localhost`, or an HTTP-only backend.

## 2. Push the frontend to a Git provider

Commit this repository and push it to GitHub, GitLab, or Bitbucket. Before pushing, confirm that `.env.local`, `.vercel/`, service-account JSON files, private keys, and backend secrets are not tracked.

## 3. Import the repository into Vercel

1. Sign in at <https://vercel.com>.
2. Select **Add New > Project**.
3. Import this frontend repository.
4. Keep the repository root as the **Root Directory**.
5. Vercel should detect **Vite**. The checked-in `vercel.json` sets:
   - Install command: `npm ci`
   - Build command: `npm run build:vercel`
   - Output directory: `dist`
   - SPA fallback: every client route resolves to `index.html`
6. Do not deploy until the required environment variables are entered.

## 4. Configure Vercel environment variables

In **Project Settings > Environment Variables**, add the following values from Firebase Console **Project settings > General > Your apps > Web app**:

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY` | Yes | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes | Keep the Firebase Web App value, normally `trading-agent-6457f.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Yes | `trading-agent-6457f` |
| `VITE_FIREBASE_APP_ID` | Yes | Firebase Web App ID |
| `VITE_FIREBASE_DATABASE_ID` | Yes | `(default)` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | No | Firebase Web App value |
| `VITE_FIREBASE_STORAGE_BUCKET` | No | Firebase Web App value |
| `VITE_FIREBASE_MEASUREMENT_ID` | No | Firebase Web App value |
| `VITE_TRADINGAGENTS_API_URL` | Full analysis only | Public backend origin such as `https://api.example.com` |

Apply the required Firebase variables to **Production** and **Preview** if preview deployments must build. Vite embeds every `VITE_*` value into public browser JavaScript, so these fields must contain only Firebase Web configuration and the public API origin—never a service-account JSON, private key, LLM key, or backend secret.

The Vercel build intentionally fails before bundling when required variables are missing, the Firebase project/database is wrong, or a configured backend origin is not public HTTPS.

## 5. Deploy and record the production hostname

Select **Deploy**. After the build succeeds, record the hostname, for example:

```text
tradingagents-workstation.vercel.app
```

Use the actual hostname Vercel assigned. Do not include `https://` or a path when entering it in Firebase Authorized Domains.

## 6. Authorize the Vercel hostname in Firebase

1. Open Firebase Console for project `trading-agent-6457f`.
2. Go to **Authentication > Settings > Authorized domains**.
3. Add the exact production hostname, for example `tradingagents-workstation.vercel.app`.
4. If you test Google login on a Vercel preview hostname, add that exact stable preview/branch hostname too. Firebase does not use the Vercel project name as an automatic wildcard.
5. Keep `VITE_FIREBASE_AUTH_DOMAIN` set to the Firebase Web App value unless you deliberately configure a Firebase custom authentication domain.

If the Firebase Web API key has HTTP-referrer restrictions in Google Cloud Console, also allow the production origin and any deliberate preview/custom origins.

## 7. Configure the backend for full-analysis mode

Skip this section for history-only mode. On the deployed FastAPI backend, configure at least:

```dotenv
WEB_CORS_ORIGINS=https://YOUR-VERCEL-HOSTNAME
WEB_AUTH_REQUIRED=true
WEB_AUTH_ALLOWED_EMAILS=williamthudd@gmail.com
FIREBASE_ENABLED=true
FIREBASE_PROJECT_ID=trading-agent-6457f
FIREBASE_DATABASE_ID=(default)
```

The backend—not Vercel—must hold Firebase Admin credentials and LLM/provider secrets. Ensure CORS permits the exact Vercel production origin and the `Authorization` and `Content-Type` request headers, then restart or redeploy the backend.

## 8. Redeploy after environment changes

Vite variables are consumed at build time. After adding or changing a Vercel environment variable, create a new deployment from **Deployments > Redeploy** or push another commit. Existing deployments do not receive the new value.

## 9. Production smoke test

1. Open the production URL in a private browser window.
2. Sign in with `williamthudd@gmail.com` using Google.
3. Confirm Daily History loads from Firestore.
4. Confirm another Google account is rejected and signed out.
5. For full-analysis mode, confirm the header reports the engine as ready and launch a harmless test analysis.
6. Open `/deployment-check` directly. The SPA should render instead of returning a Vercel 404.

## CLI alternative

After configuring the environment variables in the Vercel dashboard, you can link and deploy from this repository:

```powershell
npx vercel login
npx vercel
npx vercel --prod
```

The first deployment links the local directory to a Vercel project and creates `.vercel/`, which is intentionally ignored by Git.
