import "dotenv/config";

import { pathToFileURL } from "node:url";

/**
 * Week 2 Step 2: configure the private document bucket (`npm run storage:setup`).
 *
 * Creates the bucket if missing and enforces, at the Storage layer:
 * - public = false (objects are reachable only through short-lived signed URLs),
 * - a per-object size limit equal to the largest app limit (MAX_PDF_BYTES / MAX_IMAGE_BYTES),
 * - an allow-list of PDF, PNG and JPEG MIME types.
 * The completion route still re-validates every stored object's bytes; these limits stop
 * oversized or wrong-type objects from being stored at all via a signed upload URL.
 */

export const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export function buildBucketOptions(env) {
  const maxPdf = Number(env.MAX_PDF_BYTES || 10_485_760);
  const maxImage = Number(env.MAX_IMAGE_BYTES || 7_000_000);
  if (!Number.isInteger(maxPdf) || maxPdf <= 0 || !Number.isInteger(maxImage) || maxImage <= 0) {
    throw new Error("MAX_PDF_BYTES and MAX_IMAGE_BYTES must be positive integers.");
  }
  return {
    public: false,
    fileSizeLimit: Math.max(maxPdf, maxImage),
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
  };
}

export function bucketMatches(bucket, options) {
  return (
    bucket.public === options.public &&
    Number(bucket.file_size_limit) === options.fileSizeLimit &&
    Array.isArray(bucket.allowed_mime_types) &&
    [...bucket.allowed_mime_types].sort().join(",") === [...options.allowedMimeTypes].sort().join(",")
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "shipment-documents";
  if (!url || !secretKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const options = buildBucketOptions(process.env);

  const { data: existing } = await admin.storage.getBucket(bucketName);
  if (!existing) {
    const { error } = await admin.storage.createBucket(bucketName, options);
    if (error) throw new Error(`Could not create bucket "${bucketName}".`);
    console.log(`Created private bucket "${bucketName}".`);
  } else if (!bucketMatches(existing, options)) {
    const { error } = await admin.storage.updateBucket(bucketName, options);
    if (error) throw new Error(`Could not update bucket "${bucketName}".`);
    console.log(`Updated bucket "${bucketName}".`);
  } else {
    console.log(`Bucket "${bucketName}" already matches the required configuration.`);
  }

  const { data: after } = await admin.storage.getBucket(bucketName);
  if (!after || !bucketMatches(after, options)) {
    throw new Error(`Bucket "${bucketName}" does not have the required configuration after setup.`);
  }
  console.log(
    `public=${after.public} file_size_limit=${after.file_size_limit} allowed_mime_types=${after.allowed_mime_types.join(",")}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Storage setup failed.");
    process.exit(1);
  });
}
