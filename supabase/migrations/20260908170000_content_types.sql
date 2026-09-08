-- Content types: an article is prose, a skill is a Markdown file written to
-- Claude's skill conventions. The distinction exists so that "give me my
-- skills" can be answered without also returning every meeting note.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'content_type') then
    create type public.content_type as enum ('article', 'skill');
  end if;
end $$;

alter table public.nodes
  add column if not exists content_type public.content_type;

-- Folders are untyped: a folder is not prose and not a skill, and giving it a
-- type would invite filters that quietly include or exclude the containers
-- rather than the documents.
alter table public.nodes
  drop constraint if exists nodes_content_type_files_only;
alter table public.nodes
  add constraint nodes_content_type_files_only check (
    (kind = 'file' and content_type is not null)
    or (kind = 'folder' and content_type is null)
  ) not valid;

/**
 * Keeps content_type consistent with kind.
 *
 * A default on the column cannot do this: it would type folders too, and it
 * would not correct a caller who supplies a type for one. Doing it in a trigger
 * means no write path can produce a row the constraint would reject, which is
 * what lets the constraint be an assertion rather than an error message users
 * see.
 */
create or replace function public.normalize_content_type()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'folder' then
    new.content_type := null;
  else
    new.content_type := coalesce(new.content_type, 'article');
  end if;
  return new;
end;
$$;

drop trigger if exists nodes_normalize_content_type on public.nodes;

-- Before the path trigger's number, so ordering between them is stable and
-- obvious; they touch different columns, so it does not otherwise matter.
create trigger nodes_normalize_content_type
  before insert or update on public.nodes
  for each row execute function public.normalize_content_type();

-- Existing rows predate the trigger, so bring them in line before validating.
update public.nodes
   set content_type = case when kind = 'file' then 'article'::public.content_type end
 where (kind = 'file' and content_type is null)
    or (kind = 'folder' and content_type is not null);

alter table public.nodes
  validate constraint nodes_content_type_files_only;

-- Filtering by type is always within a space, so the index leads with it.
create index if not exists nodes_content_type_idx
  on public.nodes (space_id, content_type)
  where content_type is not null;
