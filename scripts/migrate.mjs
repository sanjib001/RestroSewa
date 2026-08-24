#!/usr/bin/env node
/**
 * Migration runner.
 *
 * WHY THIS EXISTS: migrations used to be applied by hand, and the only record of
 * what had run where was somebody's memory. Production's Supabase ledger held two
 * rows from June pointing at files that no longer exist, while all 56 real
 * migrations were unrecorded — so `supabase db push` would have tried to replay
 * everything from scratch.
 *
 * It writes to `supabase_migrations.schema_migrations`, the SAME table the
 * Supabase CLI uses, rather than inventing a private one. That way the ledger
 * stays truthful for both this runner and the CLI.
 *
 *   node scripts/migrate.mjs status            what's applied where (default: dev)
 *   node scripts/migrate.mjs up                apply pending migrations to DEV
 *   node scripts/migrate.mjs up --prod         …to PRODUCTION (asks for --yes)
 *   node scripts/migrate.mjs baseline          record every file as already applied
 *   node scripts/migrate.mjs status --prod
 *
 *   node scripts/migrate.mjs up --env .env.hrestrosewa --http --yes
 *                                              …to any other target (see below)
 *
 * Safety rules, in order of importance:
 *   1. DEV is the default target. Production needs BOTH --prod and --yes.
 *   2. Each migration runs in its OWN transaction, together with the ledger
 *      insert — so "applied" and "recorded" can never disagree, even on a crash.
 *   3. A failure stops the run. Later migrations almost always depend on earlier
 *      ones, and continuing past a break produces a schema matching nothing.
 *
 * --env / --http / --no-ssl exist for the self-hosted Supabase on DigitalOcean:
 *
 *   • --env <file> targets an env file that is not one of the two known names.
 *   • --http sends SQL through Kong's `/pg/query` instead of connecting to
 *     Postgres directly. The self-hosted database sits on a Docker-internal
 *     network with no published port, so there is nothing to connect TO — but
 *     Kong is public, authenticated by the service-role key, and reaches the
 *     database as a superuser. See lib/pg-http.mjs.
 *   • --no-ssl is for a direct connection to a container without TLS (e.g. over
 *     an SSH tunnel); node-postgres does not negotiate down, so asking for SSL
 *     against a server without it fails outright rather than falling back.
 *
 * Under --http each migration is wrapped in an explicit `begin … commit`, because
 * one HTTP request is one connection: the implicit single-statement transaction
 * a direct connection would give us does not span the file plus its ledger row.
 *
 * --env carries the SAME production interlock as everything else: whatever file
 * is named, if it resolves to the production project ref the run is refused
 * unless --prod was also given. A mislabelled env file cannot smuggle itself in.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HttpClient, toLiteral } from "./lib/pg-http.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "supabase", "migrations");
const PROD_REF = "qsccnzgrhrnjggyymefr";

const args = process.argv.slice(2);
const useProd = args.includes("--prod");
const confirmed = args.includes("--yes");
const noSsl = args.includes("--no-ssl");
const useHttp = args.includes("--http");

// `--env <file>` takes a value, so the value must not also be read as the command.
const envIdx = args.indexOf("--env");
const envArg = envIdx !== -1 ? args[envIdx + 1] : null;
if (envIdx !== -1 && !envArg) throw new Error("--env needs a file, e.g. --env .env.hrestrosewa");
// The `i !== envIdx + 1` guard must not fire when there is no --env: envIdx is
// then -1, and envIdx + 1 is 0 — which would swallow the command itself.
const cmd = args.find((a, i) => !a.startsWith("-") && !(envIdx !== -1 && i === envIdx + 1)) ?? "status";

// ── connection ────────────────────────────────────────────────────────────────
function connect(envFile) {
  const file = path.join(ROOT, envFile);
  if (!fs.existsSync(file)) throw new Error(`${envFile} not found`);
  const env = fs.readFileSync(file, "utf8");
  const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const url = get("NEXT_PUBLIC_SUPABASE_URL");
  // Only a hosted project HAS a ref. A self-hosted URL yields "unknown", which
  // can never equal PROD_REF — so the interlock stays safe by default.
  const ref = url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown";

  if (useHttp) {
    const key = get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) throw new Error(`SUPABASE_SERVICE_ROLE_KEY missing from ${envFile}`);
    return { client: new HttpClient({ url, key }), ref };
  }

  const raw = get("SUPABASE_DB_URL");
  if (!raw) throw new Error(`SUPABASE_DB_URL missing from ${envFile}`);
  const m = raw.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error(`SUPABASE_DB_URL in ${envFile} is not a parseable connection string`);
  return {
    client: new pg.Client({
      user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5],
      ssl: noSsl ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
    }),
    ref,
  };
}

const files = () =>
  fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ file: f, version: f.split("_")[0], name: f.replace(/^\d+_/, "").replace(/\.sql$/, "") }));

async function ensureLedger(c) {
  await c.query(`create schema if not exists supabase_migrations`);
  await c.query(`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    )`);
}

const applied = async (c) =>
  new Set((await c.query(`select version from supabase_migrations.schema_migrations`)).rows.map((r) => r.version));

// ── commands ──────────────────────────────────────────────────────────────────
async function main() {
  if (envArg && useProd) throw new Error("--env and --prod name two different targets — pick one");

  const envFile = envArg ?? (useProd ? ".env.production" : ".env.local");
  const { client: c, ref } = connect(envFile);
  const target = envArg ? `CUSTOM ${envArg}` : useProd ? "PRODUCTION" : "DEV";

  // Belt and braces: the flag says prod, the project ref must agree.
  if (useProd && ref !== PROD_REF) throw new Error(`--prod given but ${envFile} points at ${ref}`);
  // Applies to --env too: naming a file is not a licence to write to production.
  if (!useProd && ref === PROD_REF) throw new Error(`${envFile} points at PRODUCTION — refusing`);

  await c.connect();
  await ensureLedger(c);

  const all = files();
  const done = await applied(c);
  const pending = all.filter((m) => !done.has(m.version));

  console.log(`target: ${target} (${ref})`);
  console.log(`migrations on disk: ${all.length}   applied: ${all.length - pending.length}   pending: ${pending.length}\n`);

  if (cmd === "status") {
    for (const m of pending) console.log(`  PENDING  ${m.file}`);
    // Ledger rows with no file: stale history, worth surfacing but never deleted.
    const orphans = [...done].filter((v) => !all.some((m) => m.version === v));
    if (orphans.length) console.log(`\n  ${orphans.length} ledger row(s) with no matching file: ${orphans.join(", ")}`);
    if (!pending.length) console.log("  up to date");
  }

  else if (cmd === "baseline") {
    // Records every file as applied WITHOUT running it — for a database that
    // already has the schema but no ledger. Never use on a fresh database.
    if (!confirmed) {
      console.log("baseline records all files as applied WITHOUT running them.");
      console.log("Only correct when the schema is already in place. Re-run with --yes.");
      await c.end(); return;
    }
    for (const m of pending) {
      await c.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, $3) on conflict (version) do nothing`,
        [m.version, m.name, [`-- baselined ${new Date().toISOString()}: schema already present`]]
      );
      console.log(`  recorded ${m.file}`);
    }
    console.log(`\nbaselined ${pending.length} migration(s)`);
  }

  else if (cmd === "up") {
    if (!pending.length) { console.log("nothing to do"); await c.end(); return; }
    // DEV is the only target you can write to without saying so out loud.
    if ((useProd || envArg) && !confirmed) {
      for (const m of pending) console.log(`  would apply  ${m.file}`);
      console.log(`\nThis is ${target}. Re-run with --yes to apply.`);
      await c.end(); return;
    }
    for (const m of pending) {
      const sql = fs.readFileSync(path.join(DIR, m.file), "utf8");
      process.stdout.write(`  ${m.file.padEnd(54)} `);
      try {
        // ONE statement string containing the migration AND its ledger row, so
        // "applied" and "recorded" cannot disagree even on a crash. It is built
        // rather than issued as separate calls because under --http every call
        // is a separate connection, and a `begin` on one of those commits
        // nothing on the next. A direct connection is happy with the same shape.
        //
        // Literals are rendered here rather than passed as params: the migration
        // body is concatenated in verbatim, and handing it to a substituting
        // layer would let a `$1` inside a plpgsql function be rewritten.
        const body = sql.trim().replace(/;\s*$/, ""); // avoid an empty `;;` statement
        await c.query(
          `begin;\n${body};\n` +
            `insert into supabase_migrations.schema_migrations (version, name, statements) ` +
            `values (${toLiteral(m.version)}, ${toLiteral(m.name)}, ${toLiteral([sql])});\n` +
            `commit;`
        );
        console.log("applied");
      } catch (e) {
        // The failed statement already aborted its own transaction; this just
        // makes sure a direct connection is not left sitting in one.
        try { await c.query("rollback"); } catch { /* already rolled back */ }
        console.log("FAILED");
        console.error(`\n${m.file}:\n${e.message}\n`);
        console.error("Stopped. Nothing from this migration was kept.");
        await c.end();
        process.exit(1);
      }
    }
    console.log(`\napplied ${pending.length} migration(s)`);

    // PostgREST caches the schema and only rebuilds it on this signal. The
    // hosted projects ship `pgrst_ddl_watch`/`pgrst_drop_watch` event triggers
    // that fire it automatically; the self-hosted droplet has NO event triggers
    // at all, so a migration there lands in the database and stays invisible to
    // the API — `PGRST205 Could not find the table` on a table that plainly
    // exists. Hit for real after 20260824000000_salary_cycles.sql.
    //
    // Sending it here covers every target: redundant where the event triggers
    // already do it, essential where they do not. A failure is reported but not
    // fatal — the migrations are already committed, and refusing to exit 0 over
    // a cache hint would misreport the run.
    try {
      await c.query("notify pgrst, 'reload schema'");
      console.log("schema cache reload signalled");
    } catch (e) {
      console.error(`\nWARNING: could not signal a PostgREST schema reload: ${e.message}`);
      console.error("The migrations ARE applied. If the API 404s on a new table, restart PostgREST.");
    }
  }

  else {
    console.log(`unknown command "${cmd}" — use status | up | baseline`);
  }

  await c.end();
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
