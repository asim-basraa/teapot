-- Backlink maintenance.

/**
 * Replaces the outgoing links of a node.
 *
 * One statement rather than a delete followed by an insert, so a reader never
 * catches the page mid-rewrite with its backlinks briefly missing.
 *
 * Deliberately NOT security definer. Every write here must pass the same policy
 * an ordinary update would: links_write_editable_source requires edit on the
 * source, and rows for a source the caller cannot edit are simply refused. A
 * definer function would have to re-state that check, which is one more place
 * for it to drift from the policy.
 *
 * Targets the caller cannot read are absent from p_target_ids before this is
 * called, because the resolution that produced them ran under the same RLS.
 * That is the intended behaviour: you cannot record a link to a page you cannot
 * see, so a link table cannot be used to assert that one exists.
 */
create or replace function public.set_node_links(
  p_source_node_id uuid,
  p_target_ids uuid[]
)
returns void
language sql
as $$
  with removed as (
    delete from public.links
     where source_node_id = p_source_node_id
       and not (target_node_id = any(coalesce(p_target_ids, '{}'::uuid[])))
    returning 1
  )
  insert into public.links (space_id, source_node_id, target_node_id)
  select n.space_id, p_source_node_id, t.id
    from unnest(coalesce(p_target_ids, '{}'::uuid[])) as t(id)
    join public.nodes n on n.id = p_source_node_id
   where t.id <> p_source_node_id
  on conflict (source_node_id, target_node_id) do nothing;
$$;

revoke all on function public.set_node_links(uuid, uuid[]) from public, anon;
grant execute on function public.set_node_links(uuid, uuid[])
  to authenticated, service_role;
