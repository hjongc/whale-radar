# Deployment Guide (Vercel + Supabase)

This document defines environment boundaries for local, preview, and production.

## Environment Matrix

| Variable | Local | Preview | Production | Public? | Notes |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | Required | Required | Required | Yes | UI label only. |
| `NEXT_PUBLIC_API_BASE_URL` | Required | Optional | Optional | Yes | Use local URL in dev, empty in Vercel if same-origin API routes are used. |
| `NEXT_PUBLIC_SUPABASE_URL` | Required | Required | Required | Yes | Safe to expose. Points to environment-specific Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | Required | Required | Yes | Public anon key only. Never use service role here. |
| `CRON_SECRET` | Required | Required | Required | No | Server-only auth for `/api/ops/*` routes. Must never be `NEXT_PUBLIC_*`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Required | Required | No | Privileged server key. Never expose to browser. |
| `SUPABASE_PROJECT_REF` | Optional | Required | Required | No | Server/runtime metadata for project targeting and ops debugging. |
| `VERCEL_ENV` | Auto | Auto | Auto | No | Provided by Vercel (`development`, `preview`, `production`). |

## Boundary Rules

- Prefix with `NEXT_PUBLIC_` only when a key is intentionally browser-exposed.
- `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are server-only and must be configured only in Vercel Environment Variables (not committed to source).
- If any server-only key appears in client bundles, treat it as a deployment blocker.

## Vercel Setup

1. Import the project in Vercel.
2. Confirm `vercel.json` is present and committed.
3. In Vercel Project Settings > Environment Variables, add values for **Preview** and **Production** separately:
   - Public: `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Server-only: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`
4. Trigger a preview deployment.

## Supabase Environment Mapping

- Use separate Supabase projects for preview and production.
- Map each Vercel environment to its matching Supabase URL/keys:
  - Preview deploy -> Preview Supabase project
  - Production deploy -> Production Supabase project
- Do not reuse production service role key in preview.

## Preview Smoke Path

Use this sequence after each preview deploy.

1. Verify build locally:

```bash
npm run build
```

2. Verify client bundle secret guard:

```bash
npm run scan:client-secrets
```

3. Open preview URL (or local fallback) and verify routes render:
   - `/market`
   - `/whales`

4. Confirm no runtime env errors are present.

### Local fallback when preview URL is unavailable

Run local dev smoke and save evidence screenshot:

```bash
npm run dev
# open http://127.0.0.1:3000/market then /whales and capture screenshot evidence
```

## Operator Checklist

- [ ] All required keys exist in local `.env.local` for dev.
- [ ] Vercel Preview and Production variables are set independently.
- [ ] No server-only key uses `NEXT_PUBLIC_` prefix.
- [ ] `npm run build` passes.
- [ ] `npm run scan:client-secrets` passes.
- [ ] Smoke check verifies `/market` and `/whales` render successfully.
