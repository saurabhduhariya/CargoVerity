import { randomUUID } from "node:crypto";

/**
 * Minimal in-memory stand-ins for the Prisma calls and Supabase Storage calls used by the
 * Week 2 upload service. They implement real behavior (filtering, the one-current-version
 * constraint, conditional updates, transaction rollback) so tests exercise the service logic
 * rather than asserting on mock call shapes. PostgreSQL behavior is covered separately by
 * tests/integration/documents-upload.test.ts.
 */

type Row = Record<string, unknown>;

export type FakeShipment = {
  id: string;
  reference: string;
  createdById: string;
  status: string;
  currentRevision: number;
};

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Date)) {
      const c = condition as { notIn?: unknown[]; in?: unknown[] };
      if (c.notIn) return !c.notIn.includes(row[key]);
      if (c.in) return c.in.includes(row[key]);
    }
    return row[key] === condition;
  });
}

function pick(row: Row, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

export function createFakeDb(init: { shipments: FakeShipment[]; documents?: Row[] }) {
  const state = {
    shipments: init.shipments.map((s) => ({ ...s }) as Row),
    documents: (init.documents ?? []).map((d) => ({ ...d })),
    audits: [] as Row[],
  };

  const prisma = {
    shipment: {
      findFirst: async ({ where }: { where: Row }) => {
        const row = state.shipments.find((s) => matches(s, where));
        return row ? { ...row } : null;
      },
      findUnique: async ({ where, select }: { where: Row; select?: Record<string, boolean> }) => {
        const row = state.shipments.find((s) => matches(s, where));
        return row ? pick(row, select) : null;
      },
      findUniqueOrThrow: async ({ where }: { where: Row }) => {
        const row = state.shipments.find((s) => matches(s, where));
        if (!row) throw new Error("not found");
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.shipments.filter((s) => matches(s, where));
        for (const row of rows) {
          for (const [key, value] of Object.entries(data)) {
            row[key] =
              value && typeof value === "object" && "increment" in value
                ? (row[key] as number) + (value as { increment: number }).increment
                : value;
          }
        }
        return { count: rows.length };
      },
    },
    document: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = state.documents.find((d) => d.id === where.id);
        return row ? { ...row } : null;
      },
      findFirst: async ({ where, select }: { where: Row; select?: Record<string, boolean> }) => {
        const rows = state.documents
          .filter((d) => matches(d, where))
          .sort((a, b) => (b.documentVersion as number) - (a.documentVersion as number));
        return rows[0] ? pick(rows[0], select) : null;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.documents.filter((d) => matches(d, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: randomUUID(), extractionStatus: "UPLOADED", createdAt: new Date(), ...data };
        if (state.documents.some((d) => d.id === row.id)) {
          throw Object.assign(new Error("Unique constraint failed on Document_pkey"), { code: "P2002" });
        }
        if (
          row.isCurrent &&
          state.documents.some(
            (d) => d.isCurrent && d.shipmentId === row.shipmentId && d.selectedDocType === row.selectedDocType,
          )
        ) {
          throw Object.assign(new Error("Unique constraint failed on Document_one_current_per_type_key"), {
            code: "P2002",
          });
        }
        state.documents.push(row);
        return { ...row };
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Row }) => {
        state.audits.push({ ...data });
        return { id: randomUUID(), ...data };
      },
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      const snapshot = structuredClone({
        shipments: state.shipments,
        documents: state.documents,
        audits: state.audits,
      });
      try {
        return await callback(prisma);
      } catch (error) {
        state.shipments = snapshot.shipments;
        state.documents = snapshot.documents;
        state.audits = snapshot.audits;
        throw error;
      }
    },
  };

  return { prisma, state };
}

export function createFakeStorage(initial: Record<string, Uint8Array> = {}) {
  const objects = new Map(Object.entries(initial));
  const removed: string[] = [];
  const bucketApi = {
    download: async (key: string) =>
      objects.has(key)
        ? { data: new Blob([objects.get(key)! as BlobPart]), error: null }
        : { data: null, error: { message: "Object not found" } },
    remove: async (keys: string[]) => {
      keys.forEach((key) => {
        objects.delete(key);
        removed.push(key);
      });
      return { data: [], error: null };
    },
    upload: async (key: string, bytes: Uint8Array) => {
      if (objects.has(key)) return { data: null, error: { message: "The resource already exists" } };
      objects.set(key, bytes);
      return { data: { path: key }, error: null };
    },
    createSignedUploadUrl: async (key: string) => ({
      data: { signedUrl: `https://storage.example.test/upload/sign/${key}?token=t`, token: "t", path: key },
      error: null,
    }),
  };
  return {
    objects,
    removed,
    supabaseAdmin: { storage: { from: () => bucketApi } },
  };
}
