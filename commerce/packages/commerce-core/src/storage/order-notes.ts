import type { CommerceRepositories } from "./repositories.js";

export type OrderNoteType = "private" | "customer";

export interface OrderNoteDocument {
  id: string;
  orderId: string;
  note: string;
  type: OrderNoteType;
  system?: boolean;
  createdAt: string;
}

export async function addOrderNote(
  repositories: CommerceRepositories,
  input: { orderId: string; note: string; type?: OrderNoteType; system?: boolean },
): Promise<OrderNoteDocument> {
  const document: OrderNoteDocument = {
    id: crypto.randomUUID(),
    orderId: input.orderId,
    note: input.note,
    type: input.type ?? "private",
    ...(input.system ? { system: true } : {}),
    createdAt: new Date().toISOString(),
  };
  await repositories.orderNotes.put(document.id, document as never);
  return document;
}

export async function listOrderNotes(repositories: CommerceRepositories, orderId: string): Promise<OrderNoteDocument[]> {
  const page = await repositories.orderNotes.query({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    limit: 100,
  });
  return page.items.map(({ data }) => data as unknown as OrderNoteDocument);
}
