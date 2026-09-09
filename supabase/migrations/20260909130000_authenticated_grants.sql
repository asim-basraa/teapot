-- Sharing with everyone who has an account.
--
-- There were two ends of the range and nothing in between: a named person or a
-- named team on one side, and `public`, meaning the open internet, on the other.
-- "Everyone here" is the thing people actually reach for most often, and its
-- absence pushes them towards publishing, which is not the same thing at all.
--
-- Deliberately a grantee type rather than an "Everyone" team. A team is scoped
-- to one space and may only be granted inside it, so an Everyone team would
-- have to exist separately in every space, with something keeping each roster
-- in step as people sign up. That is a membership list that silently grows and
-- can drift out of step, which is precisely the hazard the same-space rule
-- exists to prevent. This has no roster to maintain and means the same thing
-- everywhere.

alter type public.grantee_type add value if not exists 'authenticated';
