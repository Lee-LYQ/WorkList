# Worklist

A static React app hosted on GitHub Pages, with Supabase as its database. People collaborate through a share URL and do not need an account.

## Local development

1. Copy `web/.env.example` to `web/.env.local` and fill in the project's Supabase URL and publishable key. These are browser-facing values; never put a Supabase secret/service-role key in the frontend.
2. From `web/`, run `npm install` once and `npm run dev` to start the site.

The data model is `projects → lists → items`. Each project has its own share URL containing a random bearer token in the URL fragment. Anyone holding that project's link can manage its project name, Lists, and items. The database stores only a SHA-256 hash of the token; rotating the link invalidates the previous URL. Do not use this for sensitive information.

## Database

The migration in `supabase/migrations/` creates project, List, and item tables plus anonymous RPCs. The tables have RLS enabled and no direct client grants; the RPCs validate the project share token before reading or changing data. Created project links are remembered in the current browser; copy and share a project's link with collaborators to let them open it elsewhere.

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

GitHub Pages sites are public, including sites built from private repositories when the plan supports private-repository Pages. Confirm Pages availability for this private repository's plan before enabling deployment. The published frontend and its publishable key are public; project data remains protected by the share token.