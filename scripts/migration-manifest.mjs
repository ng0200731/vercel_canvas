#!/usr/bin/env node
/**
 * Create a migration manifest for a local PostgreSQL/.data export and, when
 * explicitly enabled, copy local upload objects into Supabase Storage.
 *
 * This script intentionally does not import relational rows: auth-user mapping,
 * foreign keys, and production overwrite policy must be reviewed before that
 * irreversible step. Use the manifest alongside a reviewed pg_dump restore.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const sourceRoot = path.resolve(process.env.LOCAL_UPLOAD_ROOT ?? ".data/uploads");
const output = path.resolve(process.env.MIGRATION_MANIFEST ?? "migration-manifest.json");
const localUserId = process.env.LOCAL_USER_ID ?? "00000000-0000-4000-8000-000000000001";
const targetUserId = process.env.TARGET_USER_ID ?? localUserId;

async function hashFile(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function filesUnder(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const stat = await fs.stat(absolute);
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        result.push({
          sourcePath: relative,
          targetPath: `${targetUserId}/${relative.includes("/") ? relative.slice(relative.indexOf("/") + 1) : relative}`,
          bytes: stat.size,
          sha256: await hashFile(absolute),
        });
      }
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return result;
}

async function tableCounts() {
  if (!process.env.DATABASE_URL) return {};
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tables = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);
    const counts = {};
    for (const { table_name: table } of tables.rows) {
      const safe = `"${table.replaceAll('"', '""')}"`;
      const row = await client.query(`select count(*)::int as count from public.${safe}`);
      counts[table] = row.rows[0].count;
    }
    return counts;
  } finally {
    await client.end();
  }
}

async function copyObjects(files) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to upload.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const item of files) {
    const source = path.join(sourceRoot, item.sourcePath);
    const body = await fs.readFile(source);
    const { error } = await supabase.storage.from("uploads").upload(item.targetPath, body, {
      contentType: contentType(path.extname(source)),
      upsert: false,
    });
    if (error && !/already exists/i.test(error.message)) throw new Error(`${item.targetPath}: ${error.message}`);
  }
}

function contentType(extension) {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" })[extension.toLowerCase()] ?? "application/octet-stream";
}

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  source: { database: Boolean(process.env.DATABASE_URL), uploadRoot: sourceRoot, localUserId },
  target: { userId: targetUserId },
  tables: await tableCounts(),
  files: await filesUnder(sourceRoot),
};
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${manifest.files.length} asset entries and ${Object.keys(manifest.tables).length} table counts to ${output}`);
if (args.has("--upload")) {
  if (!args.has("--confirm")) throw new Error("Asset upload requires both --upload and --confirm.");
  await copyObjects(manifest.files);
  console.log("Uploaded assets (existing objects were left unchanged).");
}
