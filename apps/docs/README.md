# AelionSDK documentation

Astro Starlight documentation for AelionSDK, maintained next to the SDK source and deployed to
GitHub Pages.

- English (default): <https://foyonaczy.github.io/AelionSDK/>
- 简体中文: <https://foyonaczy.github.io/AelionSDK/zh/>

The site uses Starlight's locale switcher. English is the default locale. Every narrative route has
an English page under `src/content/docs/` and a matching Simplified Chinese page under
`src/content/docs/zh/`. The shared sidebar uses locale-aware slugs, so both languages expose the
same complete information architecture while displaying their own page titles.

## Local development

```bash
corepack pnpm --filter @aelionsdk/docs dev
corepack pnpm --filter @aelionsdk/docs build
```

```bash
corepack pnpm dev:docs
corepack pnpm build:docs
```

Content lives in `src/content/docs`. Guides are task-oriented; Reference pages define protocols,
diagnostics, and low-level semantics. After a merge to `main`, `.github/workflows/docs.yml` builds
and deploys the site.

## Information architecture

| Directory    | Purpose                                                            |
| ------------ | ------------------------------------------------------------------ |
| `start`      | Installation, quickstart, packages, reference editor, capabilities |
| `concepts`   | Project, time, transactions, media lifecycle, execution            |
| `guides`     | Task-oriented editor integration                                   |
| `export`     | Local/remote formats, jobs, sinks, cleanup                         |
| `production` | Capability, compatibility, performance, security, recovery         |
| `reference`  | Stable fields, commands, profiles, events, protocols, terminology  |
| `project`    | Repository status, development, and release process                |
| `api`        | Generated from 13 public packages during build; not committed      |

## Writing rules

- Solve one clear problem per page; show the executable path before the boundary explanation.
- Keep Guide examples on public package entry points and current TypeScript signatures.
- Put exact fields in Reference, long-lived mechanisms in Concepts, and compatibility claims in
  Production.
- Every English narrative path must have a matching Chinese path and vice versa.
- Use `/AelionSDK/.../` for English internal routes and `/AelionSDK/zh/.../` for Chinese routes.
- Update the corresponding Guide/Reference with a new public API; TypeDoc generates API pages.
- Before merge, run `corepack pnpm run docs:check`, `corepack pnpm run build:docs`, and
  `corepack pnpm run docs:check:built`.

API generation uses `packages/*/src/index.ts`. The build clears generated TypeDoc and Astro caches
first. New public declarations should include TSDoc narrative; existing gaps are recorded in
`api-doc-coverage-baseline.json` and may only decrease.
