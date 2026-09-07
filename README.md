# Infinite Canvas AI Agent

Next.js 16 workspace application for projects, canvases, customer/supplier products, and generated images.

## Production architecture

Deploy the Next.js application to **Vercel** and use **Supabase** for the durable services already implemented by this repository:

- PostgreSQL database and Row Level Security
- Supabase Auth
- Supabase Storage for uploads and rendered/generated images (the current migration keeps the bucket public for legacy stable URLs; private signed URLs require the follow-up changes described below)

Vercel's filesystem is ephemeral. Do not use `.data/uploads`, browser localStorage/IndexedDB, `DATABASE_URL`, or `NEXT_PUBLIC_LOCAL_POSTGRES=true` for production. A Vercel deployment alone is not a durable database-plus-image store; using Vercel Blob/Marketplace Postgres instead would require replacing the existing Supabase stores, auth, SQL functions, and storage access layer.

## Deploy the app

1. Create a Supabase project and create the production user account(s).
2. Apply the numbered SQL files in [`supabase/migrations/`](supabase/migrations/) in order. Use a staging project first. The authoritative schema is the Supabase migration chain, not [`db/local-init.sql`](db/local-init.sql).
3. In Vercel, import this repository. The detected framework is Next.js and the package manager is pnpm.
4. Add these Vercel environment variables for Production (and Preview as appropriate):

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
   NEXT_PUBLIC_APP_URL=https://<your-production-domain>
   XIANGSU_API_KEY=<server-only-key-for-ai-image-generation>
   ```

   Never prefix the service-role key or `XIANGSU_API_KEY` with `NEXT_PUBLIC_`.
   Do not set `NEXT_PUBLIC_LOCAL_POSTGRES=true` in Vercel. Without
   `XIANGSU_API_KEY`, the Generate node returns "AI generation is disabled".
5. Configure Supabase Auth redirect URLs for the Vercel domain.
6. Deploy, then test sign-in, canvas persistence, product images, uploads, and generated renders.

## Existing data migration

For a complete transfer from an external local PostgreSQL instance, provide a `pg_dump` backup (or a reachable connection string) and the matching `.data/uploads` directory. The migration must:

1. Apply the Supabase schema to a new/staging project.
2. Map the local fixed owner UUID to a real Supabase Auth user UUID.
3. Import every application table, including graph nodes/edges, the canvas JSON mirror, CRM records, products/variants, images, workspace settings, canvas sends, sample orders, and app settings.
4. Copy every binary upload/render into the Supabase `uploads` bucket and rewrite `storage_path`/URL metadata.
5. Compare row counts, relationships, checksums, and image references before production cutover.

The browser recovery archive is not a complete database backup: it omits some tables and does not contain binary image files. Do not copy `.data` into Vercel.

## Private images

The schema currently creates the `uploads` bucket with public reads for the legacy direct-URL flow. For private customer/supplier and rendered images, change the bucket to private and use authorized, short-lived signed URLs (or a server-controlled image proxy) for galleries, reports, downloads, and explicitly shared canvas/sample-order links. Store canonical Storage paths in database records; do not rely on long-lived public URLs. This privacy change must be completed and tested before importing production assets.

## Development

```bash
pnpm install
pnpm dev
pnpm lint
pnpm test
pnpm build
```

For local-only Postgres development, see [`docs/SETUP.md`](docs/SETUP.md). For email configuration, see [`docs/email-setup.md`](docs/email-setup.md). AI, SMTP, and reverse-image services must use hosted, publicly reachable endpoints when called from Vercel; localhost sidecars work only during local development.
