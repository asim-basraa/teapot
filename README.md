# Postit

A multi-tenant knowledge garden: the Quartz reading experience with real
access control. See [issue #1](https://github.com/asim-basraa/teapot/issues/1)
for the PRD and the implementation slices.

## Status

Pre-Slice 1. The app currently serves a deployment tracer at `/` that reports
environment, Supabase connectivity, and build metadata, plus the same data as
JSON at `/api/health`. Both are replaced by the real application in Slice 1.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

## Environments

| Environment | App | Database |
| --- | --- | --- |
| local | `localhost:3000` | `teapot-dev` |
| CI | ephemeral | local Supabase in Docker |
| staging | Railway `staging` | `teapot-staging` |
| production | Railway `production` | `teapot` |

The product is Postit. The GitHub repository, the Railway project and the
Supabase projects still carry the name it shipped with, because renaming them
changes addresses other people and other systems already hold. They are named
here as they actually are rather than as they will be.

`NEXT_PUBLIC_*` variables reach the browser. `SUPABASE_SERVICE_ROLE_KEY` is
server-only and must never be given a `NEXT_PUBLIC_` prefix: it bypasses row
level security, which is the entire authorization model of this application.
