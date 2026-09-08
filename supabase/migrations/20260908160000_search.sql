-- Full-text search over node content.

-- Generated rather than maintained by a trigger: there is no path, migration or
-- direct write included, that can leave a row's index disagreeing with its
-- content. Names are weighted above bodies, so a page called "Roadmap" beats a
-- page that mentions the roadmap in passing.
alter table public.nodes
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

create index if not exists nodes_search_idx
  on public.nodes using gin (search_vector);

/**
 * Searches one space.
 *
 * Deliberately NOT security definer, which is the whole security argument: the
 * query runs as the caller, so nodes_select_readable removes unreadable rows
 * before this function ever sees them. There is no filter here to get wrong,
 * and no second copy of can_read to drift from the first. An anonymous caller
 * gets exactly the public subtree for the same reason.
 *
 * Highlights are marked with control characters rather than <mark> tags.
 * ts_headline does not escape what it is given, so returning HTML would mean
 * handing a page's own content back as markup, which is an injection waiting to
 * happen. The client splits on the sentinels and renders text, so the worst a
 * document containing those bytes can do is misplace a highlight.
 */
create or replace function public.search_nodes(
  p_space_id uuid,
  p_query text
)
returns table (
  id uuid,
  name text,
  path text,
  kind public.node_kind,
  snippet text,
  rank real
)
language sql
stable
as $$
  select
    n.id,
    n.name,
    n.path,
    n.kind,
    ts_headline(
      'english',
      coalesce(n.content, ''),
      q,
      'MaxFragments=1, MaxWords=30, MinWords=12, StartSel=' || chr(1)
        || ', StopSel=' || chr(2)
    ),
    ts_rank(n.search_vector, q)
  from public.nodes n,
       websearch_to_tsquery('english', p_query) q
  where n.space_id = p_space_id
    and n.search_vector @@ q
  order by ts_rank(n.search_vector, q) desc, n.name
  limit 50;
$$;

revoke all on function public.search_nodes(uuid, text) from public;
grant execute on function public.search_nodes(uuid, text)
  to anon, authenticated, service_role;
