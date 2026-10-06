import "server-only";
import { listDocuments, prisma } from "@autoapply/database";

export async function loadDocumentData(userId: string) {
  const [documents, jobs] = await Promise.all([
    listDocuments(userId),
    prisma.job.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, company: true }, orderBy: { savedAt: "desc" }, take: 200 }),
  ]);
  return { documents, jobs };
}
