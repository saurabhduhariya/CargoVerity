import { connection } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getAccuracyReport } from "@/lib/reports/accuracy";
import { AccuracyReportView } from "@/features/reports/accuracy-report-view";

export const instant = false;

export default async function ReportsPage() {
  await connection();
  const { appUser } = await requireAppUser();
  const prisma = getPrisma();

  const report = await getAccuracyReport(prisma, appUser);

  return <AccuracyReportView initialReport={report} />;
}
