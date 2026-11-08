/**
 * Removes automated-test shipments (E2E-*, QA-OPERATIONS-*, TEST-*, SHP-TEST-*, ...) and their private
 * Storage objects, keeping the demo set. Dry run by default.
 *
 *   node --env-file=.env scripts/cleanup-test-shipments.mjs          # list what would be deleted
 *   node --env-file=.env scripts/cleanup-test-shipments.mjs --apply  # delete
 *
 * Database rows cascade from Shipment (documents, runs, fields, checks, approvals, audit, exports).
 * Storage objects do not cascade, so they are removed first. Users and suppliers are untouched.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const KEEP = /^(SHP-DEMO-\d+|QA-REVIEW-.+)$/;
const apply = process.argv.includes("--apply");

const db = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await db.connect();

const { rows: shipments } = await db.query(`select id, reference, status from "Shipment"`);
const doomed = shipments.filter((s) => !KEEP.test(s.reference));
const kept = shipments.filter((s) => KEEP.test(s.reference));
const ids = doomed.map((s) => s.id);

const { rows: docs } = ids.length
  ? await db.query(`select "storageKey" from "Document" where "shipmentId" = any($1::uuid[])`, [ids])
  : { rows: [] };
const keys = docs.map((d) => d.storageKey);

console.log(`Keeping ${kept.length}: ${kept.map((s) => s.reference).join(", ")}`);
console.log(`Deleting ${doomed.length} shipments and ${keys.length} stored files${apply ? "" : " (dry run; pass --apply)"}`);

if (apply && ids.length) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "shipment-documents";
  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(keys.slice(i, i + 100));
    if (error) throw new Error(`Storage delete failed: ${error.status ?? "error"}`);
  }
  const { rowCount } = await db.query(`delete from "Shipment" where id = any($1::uuid[])`, [ids]);
  console.log(`Deleted ${rowCount} shipments.`);
}
await db.end();
