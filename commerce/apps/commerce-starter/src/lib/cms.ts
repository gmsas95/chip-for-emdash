import { getEmDashEntry } from "emdash";

export interface CmsPageEntry {
  id: string;
  data: { id?: string; title?: string; content?: unknown[] };
  edit?: { title?: Record<string, unknown>; content?: Record<string, unknown> };
}

export async function loadCmsPage(slug: string): Promise<{ page: CmsPageEntry | null; cacheHint: unknown }> {
  const result = await getEmDashEntry("pages", slug);
  return { page: result.entry as CmsPageEntry | null, cacheHint: result.cacheHint };
}
