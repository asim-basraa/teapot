"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { SearchHit } from "@/lib/search";

export function Search({ spaceId }: { spaceId: string }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const listId = useId();

  // Guards against an older response landing after a newer one and overwriting
  // it, which shows results for a query the reader has already moved on from.
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const attempt = ++latest.current;

    // Debounced, so typing a word does not fire a request per keystroke.
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/v1/search?space_id=${encodeURIComponent(spaceId)}&q=${encodeURIComponent(trimmed)}`,
      );
      if (attempt !== latest.current) return;

      const body = await res.json().catch(() => ({ hits: [] }));
      if (attempt !== latest.current) return;

      setHits(body.hits ?? []);
      setSearching(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, spaceId]);

  return (
    <div className="search">
      <label className="field">
        <span className="field-label">Search</span>
        <input
          className="input input-small"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a page"
          aria-controls={listId}
        />
      </label>

      {hits === null ? null : (
        <div id={listId} className="search-results" aria-live="polite">
          {hits.length === 0 ? (
            <p className="tree-empty">
              {searching ? "Searching…" : "Nothing matched."}
            </p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={hit.id}>
                  <Link href={hit.href} className="search-name">
                    {hit.name}
                  </Link>
                  {hit.snippet.length > 0 ? (
                    <p className="search-snippet">
                      {/* Rendered as text, never as markup: ts_headline does
                          not escape what it is handed, so the snippet is a
                          page's own content coming back. */}
                      {hit.snippet.map((run, i) =>
                        run.match ? (
                          <mark key={i}>{run.text}</mark>
                        ) : (
                          <span key={i}>{run.text}</span>
                        ),
                      )}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
