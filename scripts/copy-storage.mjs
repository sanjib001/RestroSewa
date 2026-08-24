#!/usr/bin/env node
/**
 * Copies Storage objects (restaurant logos) between Supabase projects, then
 * repoints `restaurants.logo_url` at the new host.
 *
 * WHY THIS IS SEPARATE from clone-db.mjs: `storage.objects` is a CATALOGUE, not
 * the files. Copying those rows moves the metadata and leaves the bytes behind,
 * which is worse than not copying at all — every logo becomes a broken link that
 * the database insists exists. The bytes only move over HTTP, through the Storage
 * API, so this runs after the schema exists (the bucket is created by
 * 20260712300000_restaurant_logo_storage.sql) and after clone-db.mjs has put the
 * `restaurants` rows in place to repoint.
 *
 *   node scripts/copy-storage.mjs --env .env.hrestrosewa --http --yes
 *
 * The destination Storage API is reached over its PUBLIC Kong URL, so this part
 * needs no tunnel. The logo_url rewrite is a database write, so pass --http too and it
 * goes through Kong as well — no SSH tunnel anywhere in this script.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HttpClient } from "./lib/pg-http.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD_REF = "qsccnzgrhrnjggyymefr";
const BUCKET = "restaurant-logos";

const args = process.argv.slice(2);
const noSsl = args.includes("--no-ssl");
const useHttp = args.includes("--http");
const confirmed = args.includes("--yes");
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  if (!args[i + 1]) throw new Error(`${name} needs a value`);
  return args[i + 1];
};
const targetEnv = flag("--env", null);
const sourceEnv = flag("--from", ".env.production");
if (!targetEnv) throw new Error("--env <file> is required (the DESTINATION env file)");

function readEnv(envFile) {
  const file = path.join(ROOT, envFile);
  if (!fs.existsSync(file)) throw new Error(`${envFile} not found`);
  const env = fs.readFileSync(file, "utf8");
  const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
  const raw = get("SUPABASE_DB_URL");
  const m = raw?.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error(`SUPABASE_DB_URL in ${envFile} is not a parseable connection string`);
  const url = get("NEXT_PUBLIC_SUPABASE_URL");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error(`${envFile} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
  return {
    url: url.replace(/\/$/, ""),
    key,
    ref: url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown",
    db: { user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5] },
  };
}

async function main() {
  const source = readEnv(sourceEnv);
  const target = readEnv(targetEnv);
  if (target.ref === PROD_REF) throw new Error(`${targetEnv} points at PRODUCTION — refusing to write there`);

  console.log(`source:      ${source.url}   READ ONLY`);
  console.log(`destination: ${target.url}\n`);

  const src = new pg.Client({ ...source.db, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  // Under --http the destination database is only reachable through Kong; its
  // Postgres host is a Docker-internal name that does not resolve from here.
  const dst = useHttp
    ? new HttpClient({ url: target.url, key: target.key })
    : new pg.Client({ ...target.db, ssl: noSsl ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  await src.connect();
  await dst.connect();

  // The catalogue is the authority on what exists; the public URL is how the
  // bytes come out. Both come from the source.
  const { rows: objects } = await src.query(
    `select name, metadata->>'mimetype' as mimetype, (metadata->>'size')::bigint as size
       from storage.objects where bucket_id = $1 order by name`,
    [BUCKET]
  );
  console.log(`${objects.length} object(s) in ${BUCKET}`);

  if (!confirmed) {
    for (const o of objects) console.log(`  would copy  ${o.name}  (${o.size} bytes, ${o.mimetype})`);
    console.log("\nRe-run with --yes to copy.");
    await src.end(); await dst.end(); return;
  }

  let copied = 0;
  for (const o of objects) {
    const from = `${source.url}/storage/v1/object/public/${BUCKET}/${o.name}`;
    const res = await fetch(from);
    if (!res.ok) { console.log(`  ${o.name.padEnd(40)} DOWNLOAD FAILED (${res.status})`); continue; }
    const body = Buffer.from(await res.arrayBuffer());

    const up = await fetch(`${target.url}/storage/v1/object/${BUCKET}/${o.name}`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": o.mimetype || "application/octet-stream",
        // Makes a re-run idempotent rather than a 409 wall.
        "x-upsert": "true",
      },
      body,
    });
    if (!up.ok) { console.log(`  ${o.name.padEnd(40)} UPLOAD FAILED (${up.status}) ${await up.text()}`); continue; }
    console.log(`  ${o.name.padEnd(40)} ${body.length} bytes`);
    copied++;
  }

  // Repoint the URLs. Stored as absolute URLs against the OLD project, so without
  // this every logo 404s no matter how well the bytes copied. Host-prefix swap
  // only — the path after /storage/ is identical on both sides.
  // `returning id` rather than trusting rowCount: the HTTP transport only ever
  // sees the rows a statement hands back, so an UPDATE with nothing to return
  // would always report zero.
  const { rows: updated } = await dst.query(
    `update restaurants
        set logo_url = replace(logo_url, $1, $2)
      where logo_url like $1 || '%'
      returning id`,
    [source.url, target.url]
  );
  // Second pass: rows that are on NEITHER the source host nor the target. That
  // happens whenever the destination's own public hostname changes — the rows
  // were repointed correctly by an earlier run, and then the name they were
  // pointed at moved. It happened for real at the 2026-08-21 cutover: the
  // `*.testhrestrosewa` wildcard was deleted with the Vercel domain, leaving all
  // six logos on a host that no longer resolved, and a plain re-run could not
  // fix them because the swap above only matches the SOURCE prefix.
  //
  // Anchoring on the storage path rather than any particular host makes this
  // idempotent for every future rename: whatever the URL used to say, the part
  // from `/storage/v1/object/public/` onward is identical on all Supabase hosts.
  const MARKER = "/storage/v1/object/public/";
  const { rows: rehosted } = await dst.query(
    `update restaurants
        set logo_url = $1 || substring(logo_url from position($2 in logo_url))
      where logo_url like '%' || $2 || '%'
        and logo_url not like $1 || '%'
      returning id`,
    [target.url, MARKER]
  );

  console.log(
    `\ncopied ${copied}/${objects.length} object(s); repointed ${updated.length} logo_url(s)` +
      (rehosted.length ? `, re-hosted ${rehosted.length} from a stale hostname` : "")
  );

  const { rows: left } = await dst.query(
    `select id, name, logo_url from restaurants where logo_url is not null and logo_url not like $1 || '%'`,
    [target.url]
  );
  if (left.length) {
    console.log("\nlogo_url still pointing elsewhere (review):");
    for (const r of left) console.log(`  ${r.name}: ${r.logo_url}`);
  }

  await src.end();
  await dst.end();
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
