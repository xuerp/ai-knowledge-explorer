# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## AI Radar route map

The current project routes are grouped below. Example route names in the syntax
table that follows are framework examples, not additional product pages.

| Area                | Routes                                               | Main boundary                                                                  |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Public catalog      | `/`, `/updates`, `/knowledge`, `/graph`, `/compare`  | Public, reviewed knowledge; API configuration and offline adapter are distinct |
| Entity detail       | `/knowledge/model/:slug`, `/knowledge/:type/:slug`   | Model-family/detail views and other entity types                               |
| Research            | `/ask`, `/research/:id`                              | Task input, constraints, private saved records and versions                    |
| Public sharing      | `/share/:id`                                         | Explicitly shared projection, not unrestricted access to private records       |
| Account             | `/account`, `/following`, `/settings`                | Authentication and account-owned data                                          |
| Maintenance         | `/admin/review`, `/admin/users`                      | Protected operations, enforced by backend roles                                |
| Read-only review    | `/admin/review-demo`                                 | Labelled demonstration; no live review writes                                  |
| Project information | `/case-study`, `/quality`, `/landing`, `/onboarding` | Portfolio, measured boundaries and introduction                                |

`src/server.ts` handles the deployed `/backend` proxy; it is not a browser route
file here. Its upstream and the browser API base are set separately. Local setup
and current deployment settings are documented in the repository README and
`docs/STAGING_DEPLOYMENT.md`.

## File naming examples

| File                     | URL                                                     |
| ------------------------ | ------------------------------------------------------- |
| `index.tsx`              | `/`                                                     |
| `about.tsx`              | `/about`                                                |
| `users/index.tsx`        | `/users`                                                |
| `users/$id.tsx`          | `/users/:id` (dynamic — bare `$`, no curly braces)      |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment)                  |
| `files/$.tsx`            | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx`            | layout route (renders children via `<Outlet />`)        |
| `__root.tsx`             | app shell — wraps every page; preserve `<Outlet />`     |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.
