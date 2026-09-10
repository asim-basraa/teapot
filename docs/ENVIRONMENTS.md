# Environments

Two lanes, and they must never be the same branch. Until today they were:
both the staging and the production Railway services built from `main`, so
"deploy to staging" and "deploy to production" were the same event and there was
nowhere to try anything first. This is the shape it should have had.

| | Branch | Railway environment | Supabase project | URL |
| --- | --- | --- | --- | --- |
| Staging | `staging` | `staging` | `teapot-staging` | https://web-staging-347f.up.railway.app |
| Production | `main` | `production` | `teapot` | https://web-production-f323f.up.railway.app |

## How work moves

1. Develop on a branch. Merge it into `staging` when it is ready to be seen.
2. Pushing `staging` deploys the staging site. That is where QA looks.
3. **`main` moves only when asked.** Promotion to production is a decision
   somebody makes out loud, not a side effect of finishing a piece of work.

Nothing is pushed to `main` without being asked for it, by name.

## Databases move separately, and that is the sharp edge

The Railway build does not run migrations. A schema change reaches an
environment only when somebody applies it to that environment's Supabase
project, and the code that needs it reaches the environment on a push. The two
can therefore be out of step in either direction, and the failure is quiet:

- **Code ahead of schema.** A page calls a function that is not there, RLS
  refuses a table that does not exist, and the app reports "not found" — which
  is exactly what it reports for something you are not allowed to see. It looks
  like a permission working, not a deployment half-done.
- **Schema ahead of code.** Usually harmless, because migrations here are
  additive, but the old interface can still offer something the new schema now
  refuses.

So: **apply the migration to an environment before the code that needs it
arrives there**, and never the other way round.

## Where each one stands

Check, don't assume:

```sql
select version, name from supabase_migrations.schema_migrations
order by version desc limit 5;
```

against the environment's Supabase project, and compare it with
`supabase/migrations/` on the branch that environment builds from.
