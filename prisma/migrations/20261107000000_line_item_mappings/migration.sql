-- Week 4 Step 4: Executive line-item mappings (append-only; superseded, never deleted).

-- CreateTable
CREATE TABLE "LineItemMapping" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "invoiceLineItemId" UUID NOT NULL,
    "packingListLineItemId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededById" UUID,

    CONSTRAINT "LineItemMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineItemMapping_shipmentId_supersededAt_idx" ON "LineItemMapping"("shipmentId", "supersededAt");

-- CreateIndex
CREATE INDEX "LineItemMapping_invoiceLineItemId_idx" ON "LineItemMapping"("invoiceLineItemId");

-- CreateIndex
CREATE INDEX "LineItemMapping_packingListLineItemId_idx" ON "LineItemMapping"("packingListLineItemId");

-- AddForeignKey
ALTER TABLE "LineItemMapping" ADD CONSTRAINT "LineItemMapping_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemMapping" ADD CONSTRAINT "LineItemMapping_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "LineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemMapping" ADD CONSTRAINT "LineItemMapping_packingListLineItemId_fkey" FOREIGN KEY ("packingListLineItemId") REFERENCES "LineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemMapping" ADD CONSTRAINT "LineItemMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemMapping" ADD CONSTRAINT "LineItemMapping_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL (not expressible in Prisma schema) -----------------------------------------------

-- At most one ACTIVE mapping per invoice line and per packing-list line.
CREATE UNIQUE INDEX "LineItemMapping_one_active_per_invoice_line"
    ON "LineItemMapping"("invoiceLineItemId") WHERE "supersededAt" IS NULL;

CREATE UNIQUE INDEX "LineItemMapping_one_active_per_packing_line"
    ON "LineItemMapping"("packingListLineItemId") WHERE "supersededAt" IS NULL;

-- A mapping always links two different lines.
ALTER TABLE "LineItemMapping" ADD CONSTRAINT "LineItemMapping_distinct_lines"
    CHECK ("invoiceLineItemId" <> "packingListLineItemId");

-- supersededAt and supersededById are set together (or both null).
ALTER TABLE "LineItemMapping" ADD CONSTRAINT "LineItemMapping_superseded_pair"
    CHECK (("supersededAt" IS NULL) = ("supersededById" IS NULL));
