import { Prisma, type ShipmentStatus } from "@/generated/prisma/client";

export type ShipmentListFilters = {
  search?: string;
  status?: ShipmentStatus;
  supplierId?: string;
};

export function normalizeSupplierName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSupplierKey(value: string) {
  return normalizeSupplierName(value).toLocaleLowerCase();
}

export function buildShipmentWhere(
  filters: ShipmentListFilters,
  user: { id: string; role: "EXECUTIVE" | "MANAGER" },
): Prisma.ShipmentWhereInput {
  const clauses: Prisma.ShipmentWhereInput[] = [];

  if (user.role !== "MANAGER") clauses.push({ createdById: user.id });
  if (filters.status) clauses.push({ status: filters.status });
  if (filters.supplierId) clauses.push({ supplierId: filters.supplierId });
  if (filters.search) {
    clauses.push({
      OR: [
        { reference: { contains: filters.search, mode: "insensitive" } },
        { importerName: { contains: filters.search, mode: "insensitive" } },
        { exporterName: { contains: filters.search, mode: "insensitive" } },
        { supplier: { name: { contains: filters.search, mode: "insensitive" } } },
      ],
    });
  }

  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}
