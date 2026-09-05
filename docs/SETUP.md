# Setup

The app runs with **zero configuration** in local/demo mode. Add environment keys to
switch capabilities on.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Without any keys you get: local projects/canvases (browser storage), no auth, no AI
generation. This is only demo mode.

For durable SQL on this machine during development, use **local Postgres** (Docker).
For durable multi-device cloud saves with auth, enable **Supabase**.

Priority: **cloud Supabase > local Postgres > browser localStorage**.

## Environment

Copy `.env.example` → `.env.local` and fill in what you need (all optional):

| Variable                                                            | Effect                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Enables auth + cloud Postgres persistence + Storage uploads |
| `SUPABASE_SERVICE_ROLE_KEY`                                         | Server-only admin access (storage deletes, etc.)            |
| `DATABASE_URL` + `NEXT_PUBLIC_LOCAL_POSTGRES=true`                  | Local Docker Postgres (no auth; ignored if Supabase is set) |
| `LOCAL_USER_ID`                                                     | Fixed owner UUID for local Postgres rows (optional)         |
| `XIANGSU_API_KEY`                                                   | Enables server-side image generation via Xiangsu AI         |
| `PICTURE_SHERLOCK_URL`                                              | Enables CLIP reverse-image search via local FastAPI sidecar |
| `PICTURE_SHERLOCK_TIMEOUT_MS`                                       | Sidecar client timeout (default `90000`)                    |
| `PICTURE_SHERLOCK_FALLBACK_TO_LOCAL`                                | On sidecar failure, use local histogram matcher (default true) |
| `MILVUS_MATCH_URL`                                                  | Enables CLIP + Milvus Lite reverse-image search (Docker sidecar) |
| `MILVUS_MATCH_TIMEOUT_MS`                                           | Milvus sidecar client timeout (default `90000`)             |
| `MILVUS_MATCH_FALLBACK_TO_LOCAL`                                    | On Milvus sidecar failure, use local histogram matcher (default true) |
| `NEXT_PUBLIC_APP_URL`                                               | Public app URL (defaults to `http://localhost:3000`)        |

## Local Postgres (dev, no auth)

Use this when you want real SQL durability on your machine without cloud Supabase.

1. Install Docker Desktop (or another Docker engine with Compose).
2. Clear or comment out Supabase keys in `.env.local` so cloud mode is off.
3. Set:

   ```bash
   DATABASE_URL=postgresql://canvas:canvas@localhost:15432/canvas_dev
   NEXT_PUBLIC_LOCAL_POSTGRES=true
   # optional:
   LOCAL_USER_ID=00000000-0000-4000-8000-000000000001
   ```

   Host `15432` maps to container `5432` because Windows often reserves host `5432`
   via Hyper-V excluded port ranges. If you use another free host port, keep
   `DATABASE_URL` and `docker-compose.yml` in sync.

4. Start Postgres and apply the local schema:

   ```bash
   pnpm db:up
   pnpm db:migrate
   ```

5. Run the app:

   ```bash
   pnpm dev
   ```

What you get:

- `/projects` opens with **no login**
- Projects, canvases, graph nodes/edges, images metadata, and workspace CRM
  (customers / suppliers / products / options / generic nodes) persist in Postgres
- Uploads go to `.data/uploads/` and are served from `/api/uploads/...`
- Sample-order public token flows are **out of scope** in this mode (stubbed)

Inspect data with:

```bash
docker compose exec postgres psql -U canvas -d canvas_dev
# \dt
# select id, name from projects;
```

Switch back to cloud later by putting Supabase keys back into `.env.local`
(local Postgres is ignored when Supabase is configured).

## Enabling Supabase

1. Create a project at https://supabase.com.
2. Project Settings → API → copy the **URL** and **anon** key into `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Add the
   **service_role** key as `SUPABASE_SERVICE_ROLE_KEY`.
3. Run every SQL migration in `supabase/migrations/` in the documented order via the
   Supabase SQL editor. The two files with the `0003` prefix must be run in this order:
   `0003_image_model_details.sql`, then `0003_workspace_records.sql`. The current
   repository does not yet have a CLI-safe unique migration history; do not run
   `supabase db push` until those filenames are renumbered in a coordinated migration.
4. Configure `NEXT_PUBLIC_APP_URL` with the deployed HTTPS origin and keep
   `NEXT_PUBLIC_LOCAL_POSTGRES` unset/false in Vercel.
5. Restart `pnpm dev`. Auth, projects, and canvases now persist to Postgres.

In cloud mode, production uploads use the private `uploads` bucket and the
`/api/images/file?path=...` route. It verifies the signed-in user's folder and
redirects to a short-lived signed URL. Keep Storage paths as the canonical image
identity; do not depend on permanent public URLs. Public canvas-send/sample-order
recipients need an explicitly authorized, short-lived sharing flow.

For an external local PostgreSQL migration, first create a manifest with
`pnpm migration:manifest` (set `DATABASE_URL`, `LOCAL_UPLOAD_ROOT`, and
`TARGET_USER_ID`). Review the manifest and perform a data-only `pg_dump` restore
with the local owner UUID mapped to a real Supabase Auth user. To copy local
assets, use `pnpm migration:manifest -- --upload --confirm` only after checking
that the target bucket and user mapping are correct. The command is resumable
for existing objects, but it intentionally does not import relational rows or
rewrite URLs automatically; those steps require a reviewed migration procedure.
Do not copy `.data/uploads` to Vercel's filesystem.

Canvas persistence uses structured database tables:

- `projects` and `canvases` store the workspace and canvas records.
- `canvas_nodes` stores each editable canvas node with type, position, data,
  parent, and order.
- `canvas_edges` stores each editable wire with source, target, handles, data,
  and order.
- `canvases.content` remains a JSONB compatibility mirror of `{ nodes, edges }`.
  The app saves through `replace_canvas_graph(...)`, which updates the mirror
  and replaces node/edge rows atomically.

Customer, supplier, and product records also use structured database tables:

- `customers` and `customer_employees` store customer companies and contacts.
- `suppliers` and `supplier_employees` store supplier companies, contacts, and
  typed product categories.
- `products` stores product subject, detail, material, color notes, and image
  URL metadata.
- Customer and supplier saves use database functions that update the company
  and replace employee rows in one transaction.

## Enabling AI generation

1. Obtain a Xiangsu API key and rotate any key that has been exposed publicly.
2. Add `XIANGSU_API_KEY=...` to `.env.local`.
3. Restart. Generate nodes now produce images.

## Supplier reverse-image search (Picture Sherlock CLIP sidecar)

Supplier product image matching can use a local CLIP sidecar inspired by
[Picture Sherlock](https://github.com/CN-Scars/picture_sherlock). Without the
sidecar, the app falls back to a local histogram embedding matcher.

1. Install Python 3.10+ and create a venv under `services/picture-sherlock`
   (see that folder’s `README.md` for Windows CPU torch install notes).
2. Start the sidecar:

   ```powershell
   cd services\picture-sherlock
   .\.venv\Scripts\Activate.ps1
   uvicorn app.main:app --host 127.0.0.1 --port 8091
   ```

   Or, after the venv exists: `pnpm match:sidecar`.

3. In `.env.local`:

   ```env
   PICTURE_SHERLOCK_URL=http://127.0.0.1:8091
   PICTURE_SHERLOCK_TIMEOUT_MS=90000
   PICTURE_SHERLOCK_FALLBACK_TO_LOCAL=true
   ```

4. Restart `pnpm dev`. Supplier image search uses CLIP when the sidecar is up;
   with fallback enabled it still works if the sidecar is down.

## Supplier reverse-image search (Milvus path — Database icon)

The supplier node **Database** icon uses a CLIP vector sidecar under
`services/milvus-match`. API model id: `milvus-clip-vit-base-patch32`.

**Windows (no new Docker image):** run the sidecar on the host with the
**numpy** vector backend (same request/response contract; no Milvus Lite binary).
Only Postgres stays in Docker.

1. One-time setup:

   ```powershell
   cd services\milvus-match
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
   pip install -r requirements.txt
   ```

2. Start (or `pnpm match:milvus` after the venv exists):

   ```powershell
   $env:MILVUS_MATCH_BACKEND = "numpy"
   uvicorn app.main:app --host 127.0.0.1 --port 8092
   curl http://127.0.0.1:8092/health
   ```

3. In `.env.local`:

   ```env
   MILVUS_MATCH_URL=http://127.0.0.1:8092
   MILVUS_MATCH_TIMEOUT_MS=90000
   MILVUS_MATCH_FALLBACK_TO_LOCAL=true
   ```

4. Restart `pnpm dev`. **Database** icon → this sidecar; **Eye** → Picture Sherlock.

**Optional Docker** (only if Docker Hub works): `pnpm match:milvus:docker` builds
`milvus-match` with Milvus Lite. Skip if you cannot pull new images — host numpy
mode is enough for local use.

See `services/milvus-match/README.md`.

## Scripts

```bash
pnpm dev            # dev server
pnpm build          # production build
pnpm lint           # eslint
pnpm format         # prettier --write .
pnpm test           # vitest (pure-logic unit tests)
pnpm db:up          # docker compose up -d (local Postgres only)
pnpm db:down        # docker compose down
pnpm db:migrate     # apply db/local-init.sql + seed LOCAL_USER_ID profile
pnpm match:sidecar  # Picture Sherlock CLIP FastAPI sidecar (Windows venv)
pnpm match:milvus   # Milvus-path CLIP sidecar on host :8092 (numpy backend on Windows)
pnpm match:milvus:docker  # optional: build/start milvus-match container (needs Docker Hub)
```
