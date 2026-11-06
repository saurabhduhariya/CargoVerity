import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import {
  ReviewWorkspace,
  ReviewWorkspaceInitialData,
} from "@/features/review/review-workspace";
import { getAuthorizedDocumentDownloadUrl } from "@/lib/documents/storage";
import { getLatestCrossCheckRun } from "@/lib/crosschecks/service";

export const instant = false;

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { appUser } = await requireAppUser();
  const { id } = await params;
  const prisma = getPrisma();

  // 1. Try resolving as Shipment ID
  let shipment = await prisma.shipment.findFirst({
    where: {
      id,
      ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
    },
    include: {
      supplier: true,
      documents: {
        where: { isCurrent: true },
        orderBy: { createdAt: "desc" },
        include: {
          extractionRuns: {
            where: { status: "COMPLETED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { fields: true, lineItems: true },
          },
          pages: { orderBy: { pageNumber: "asc" } },
        },
      },
    },
  });

  // 2. If not found, try resolving as Document ID (backward compatibility)
  if (!shipment) {
    const doc = await prisma.document.findUnique({
      where: { id },
      select: { shipmentId: true },
    });
    if (doc) {
      shipment = await prisma.shipment.findFirst({
        where: {
          id: doc.shipmentId,
          ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
        },
        include: {
          supplier: true,
          documents: {
            where: { isCurrent: true },
            orderBy: { createdAt: "desc" },
            include: {
              extractionRuns: {
                where: { status: "COMPLETED" },
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { fields: true, lineItems: true },
              },
              pages: { orderBy: { pageNumber: "asc" } },
            },
          },
        },
      });
    }
  }

  if (!shipment) {
    notFound();
  }

  // 3. Load latest cross-check run
  const latestRun = await getLatestCrossCheckRun({
    shipmentId: shipment.id,
    revision: shipment.currentRevision,
    prismaClient: prisma,
  });

  // 4. Resolve signed URLs and format documents
  const documents = await Promise.all(
    shipment.documents.map(async (doc) => {
      let signedUrl = "";
      try {
        const authUrlResult = await getAuthorizedDocumentDownloadUrl(prisma, {
          documentId: doc.id,
          appUser,
        });
        if (authUrlResult?.signedUrl) signedUrl = authUrlResult.signedUrl;
      } catch {
        signedUrl = `/sample-docs/${doc.originalFileName}`;
      }
      if (!signedUrl) {
        signedUrl = `/sample-docs/${doc.originalFileName}`;
      }

      const run = doc.extractionRuns[0] ?? null;

      return {
        id: doc.id,
        docType: doc.docType as "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING",
        originalFileName: doc.originalFileName,
        mimeType: doc.mimeType,
        documentVersion: doc.documentVersion,
        pageCount: doc.pageCount,
        signedUrl,
        extractionStatus: doc.extractionStatus,
        latestRunId: run?.id ?? null,
        pages: doc.pages.map((p) => ({
          id: p.id,
          pageNumber: p.pageNumber,
          isReadable: p.isReadable,
          manualEntryRequired: p.manualEntryRequired,
          reviewNote: p.reviewNote,
        })),
        fields: (run?.fields ?? []).map((f) => ({
          id: f.id,
          fieldKey: f.fieldKey,
          modelValue: f.modelValue,
          currentValue: f.currentValue,
          unit: f.unit,
          modelConfidence: f.modelConfidence ? Number(f.modelConfidence) : null,
          sourceQuote: f.sourceQuote,
          pageNumber: f.pageNumber,
          reviewStatus: f.reviewStatus,
          reviewReason: f.reviewReason,
        })),
        lineItems: (run?.lineItems ?? []).map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          description: item.description,
          hsnCode: item.hsnCode,
          quantity: item.quantity ? String(item.quantity) : null,
          quantityUnit: item.quantityUnit,
          unitPrice: item.unitPrice ? String(item.unitPrice) : null,
          lineTotal: item.lineTotal ? String(item.lineTotal) : null,
          currency: item.currency,
          sourceQuote: item.sourceQuote,
          pageNumber: item.pageNumber,
        })),
      };
    }),
  );

  // 5. Load audit trail for manager review and compliance (Rule 5)
  const auditEvents = await prisma.auditEvent.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { actor: { select: { email: true, role: true } } },
  });

  const initialData: ReviewWorkspaceInitialData = {
    shipment: {
      id: shipment.id,
      reference: shipment.reference,
      status: shipment.status,
      currentRevision: shipment.currentRevision,
      importerName: shipment.importerName,
      exporterName: shipment.exporterName,
      supplier: shipment.supplier,
    },
    currentUserRole: appUser.role,
    documents,
    crossChecks: (latestRun?.results ?? []).map((r) => ({
      id: r.id,
      ruleKey: r.ruleKey,
      ruleCode: r.ruleCode ?? undefined,
      status: r.status as "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE",
      severity: r.severity as "BLOCKING" | "WARNING",
      effectiveStatus: r.effectiveStatus,
      activeResolution: r.activeResolution
        ? {
            id: r.activeResolution.id,
            type: r.activeResolution.type,
            reason: r.activeResolution.reason,
            evidence: r.activeResolution.evidence,
            managerApprovedAt: r.activeResolution.managerApprovedAt,
            createdAt: r.activeResolution.createdAt,
            resolvedBy: r.activeResolution.resolvedBy,
          }
        : null,
      resolutions: (r.resolutions ?? []).map((res) => ({
        id: res.id,
        type: res.type,
        reason: res.reason,
        evidence: res.evidence,
        managerApprovedAt: res.managerApprovedAt,
        createdAt: res.createdAt,
        resolvedBy: res.resolvedBy,
      })),
      details: (r.details as Record<string, unknown>) ?? {},
    })),
    auditHistory: auditEvents.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      actorEmail: e.actor?.email ?? null,
      actorRole: e.actor?.role ?? null,
      metadata: (e.metadata as Record<string, unknown>) ?? null,
      createdAt: e.createdAt,
    })),
  };

  return <ReviewWorkspace initialData={initialData} />;
}
