# Vercel Deploy

This project can be deployed as a static Expo web build on Vercel.

## 1. Build locally

```bash
npm run build:web
```

The exported web app is written to `dist/`.

## 2. Deploy to Vercel

Option A: Vercel dashboard

1. Push this repo to GitHub.
2. Import the repo into Vercel.
3. Vercel will use `vercel.json`:
   - build command: `npm run build:web`
   - output directory: `dist`

Option B: Vercel CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

## 3. Add environment variables in Vercel

Copy the values from your local `.env.local` into the Vercel project settings:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_DATABASE_URL`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

Because these are `EXPO_PUBLIC_*` vars, they are embedded into the web build at build time.

## 4. Add the deployed domain to Firebase Auth

In the Firebase console:

1. Go to Authentication.
2. Open Settings / Authorized domains.
3. Add your Vercel domain, for example:
   - `your-project.vercel.app`
   - your custom domain if you attach one later

Without this step, web sign-in can fail even if the deploy succeeds.

## 5. Re-deploy after env/domain changes

If you change any `EXPO_PUBLIC_*` env vars in Vercel, trigger a new deploy so Expo rebuilds the web app with the updated values.
