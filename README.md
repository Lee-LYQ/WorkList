# Worklist

A static React app hosted on GitHub Pages, with Supabase Auth and Postgres. Project creators sign in by email magic link; collaborators can use permission-scoped share links without creating accounts.

## Local development

1. Copy `web/.env.example` to `web/.env.local` and fill in the project's Supabase URL and publishable key. These are browser-facing values; never put a Supabase secret/service-role key in the frontend.
2. From `web/`, run `npm install` once and `npm run dev` to start the site.

The data model is `projects → lists → items`. Only signed-in users can create projects, and each project is owned by its creator. Owners can issue `read`, `items`, or `lists` share links and revoke each link independently. A share link contains a random bearer token in the URL fragment; the database stores only its SHA-256 hash. Collaborators can set a temporary display name that is recorded in project activity. This name is self-declared, not verified identity. Do not use this for sensitive information.

## Database

Migrations in `supabase/migrations/` create project, List, item, share-link, and activity tables. Tables have RLS enabled and no direct client grants. Security-definer RPCs verify either the authenticated project owner or the permission attached to a share token before every operation.

Existing projects created before owner accounts were introduced keep their data and old links. An authenticated user who has an old project link can claim an unowned legacy project; the first successful claim becomes its owner. Coordinate this claim with the original project creator before upgrading.

Review the migration, then apply it to the linked Supabase project with:

```sh
npm exec --yes --package=supabase@3.0.0 -- supabase db push --remote
```

This changes the remote database schema. For local Supabase testing, install and start Docker Desktop or Podman, then run `supabase start` from the repository root.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` builds `web/` and deploys on pushes to `main`. In the repository's **Settings → Secrets and variables → Actions → Variables**, add:

- `VITE_SUPABASE_URL`: the project's URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: its publishable key (not a secret/service-role key)

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The project URL is `https://Lee-LYQ.github.io/WorkList/` after a successful deployment.

In Supabase **Authentication → URL Configuration**, allow the production redirect `https://lee-lyq.github.io/WorkList/` and the local redirect `http://localhost:5173/WorkList/` (plus any Vite port used locally). Email magic-link sign-in depends on these redirect URLs and the project's email provider settings.

The published frontend and publishable key are public. Project data is protected by owner checks and permission-scoped share tokens. Anyone holding a share link can act within that link's permission; anonymous display names are not verified identities.