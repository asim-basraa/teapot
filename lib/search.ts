import { createClient } from "@/lib/supabase/server";

/** The sentinels search_nodes wraps matches in. See the search migration. */
export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

export type SnippetRun = { text: string; match: boolean };

export type SearchHit = {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  href: string;
  /**
   * The snippet, already split into plain and highlighted runs.
   *
   * Split here rather than left as a string so no component is ever tempted to
   * put it through dangerouslySetInnerHTML: ts_headline does not escape the
   * text it is given, so a page's own content would come back as live markup.
   */
  snippet: SnippetRun[];
};

type Row = {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  snippet: string | null;
};

/**
 * Searches a space.
 *
 * No filtering happens here, and none happens in search_nodes either. That
 * function runs as the caller, so the policy on `nodes` removes everything
 * unreadable before either of us sees it. An anonymous visitor searching a
 * space gets exactly its published pages, by that same mechanism rather than
 * by a special case written for them.
 */
export async function searchSpace(
  spaceId: string,
  spaceSlug: string,
  query: string,
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_nodes", {
    p_space_id: spaceId,
    p_query: trimmed,
  });

  // websearch_to_tsquery accepts almost anything a person might type, but a
  // query that parses to nothing is a normal outcome rather than a failure.
  if (error) return [];

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    kind: row.kind,
    href: `/s/${spaceSlug}/${row.path}`,
    snippet: splitHighlights(row.snippet ?? ""),
  }));
}

/**
 * Turns a sentinel-marked snippet into runs of plain and matched text.
 *
 * Unbalanced sentinels cannot break this: an unterminated match simply runs to
 * the end of the snippet. The worst a document containing those bytes can do is
 * highlight the wrong words.
 */
export function splitHighlights(snippet: string): SnippetRun[] {
  const runs: SnippetRun[] = [];
  const [head, ...rest] = snippet.split(HIGHLIGHT_START);

  if (head) runs.push({ text: head, match: false });

  for (const segment of rest) {
    const end = segment.indexOf(HIGHLIGHT_END);

    if (end === -1) {
      if (segment) runs.push({ text: segment, match: true });
      continue;
    }

    const matched = segment.slice(0, end);
    const tail = segment.slice(end + HIGHLIGHT_END.length);
    if (matched) runs.push({ text: matched, match: true });
    if (tail) runs.push({ text: tail, match: false });
  }

  return runs;
}
