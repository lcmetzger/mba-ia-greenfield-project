---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-07-07T20:27:17-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-07T22:03:16-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-07T20:27:17-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-07-07T20:27:17-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-07-07T20:27:17-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-07-07T20:27:17-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-07T20:27:17-03:00"
  docs/phases/phase-02-auth/context.md: "2026-07-07T20:27:17-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-07-07T20:27:17-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-07T20:27:17-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** _Not specified._

**Deferred subprojects:** _None._

**Sequencing notes:** Depende de: Fase 01, Fase 02

**Neighbors (for boundary detection only):**

- **Phase 02:** Depende de: Fase 01
- **Phase 04:** Depende de: Fase 02, Fase 03

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Tecnologia de fila de processamento em segundo plano | decided | A (BullMQ + Redis) | @nestjs/bullmq, bullmq, ioredis |
| phase-03-videos/TD-02 | phase | Backend | Organização de buckets e chaves no object storage | decided | A (dois buckets, chave por UUID) | — |
| phase-03-videos/TD-03 | phase | Backend | Estratégia de upload de vídeos de até 10GB sem travar a API | decided | A (multipart upload direto via URLs pré-assinadas) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-04 | phase | Backend | Execução do worker e extração de metadados/thumbnail | decided | A (segundo bootstrap NestJS, mesmo codebase) | — |
| phase-03-videos/TD-05 | phase | Backend | URL única por vídeo e estratégia de streaming/download | decided | B (código curto + proxy autenticado) | @aws-sdk/client-s3, nanoid |
| phase-03-videos/TD-06 | phase | Backend | Ciclo de status do vídeo e tratamento de falha no processamento | decided | B (enum simples + reprocessamento manual) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-03 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-03, phase-03-videos/TD-06 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-06 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-05 |
| Download do vídeo pelo usuário | phase-03-videos/TD-05 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** **A (BullMQ + Redis)** — o caso de uso é um único tipo de job com necessidade real de retry/backoff/DLQ, exatamente o ponto forte do BullMQ, com integração oficial NestJS. RabbitMQ traria poder de roteamento não utilizado neste escopo; pg-boss evitaria um container novo, mas acoplaria a carga de processamento ao Postgres transacional do domínio e tem integração/observabilidade mais fraca — não compensa a economia de um container Redis, que é trivial de operar em Compose.
**Libraries:** @nestjs/bullmq, bullmq, ioredis

### phase-03-videos/TD-02

**Recommendation:** **A (dois buckets, chave por UUID do vídeo)** — separa a política de acesso desde já (vídeo original nunca público; thumbnail plausivelmente público em fase futura), evitando reconfigurar policies depois, e a chave derivada do `Video.id` (já um UUID gerado pela entidade) não exige nenhum mecanismo novo de geração de identificador.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** **A (multipart upload direto ao storage via URLs pré-assinadas)** — é a única opção que garante que o corpo do arquivo nunca passa pelo processo da API (Option B mantém uma conexão HTTP ocupada por até 10GB, o que ainda é o tipo de acoplamento que o requisito quer evitar) e resolve retomada de upload nativamente via reenvio de partes individuais, sem introduzir um componente de infraestrutura redundante (Option C).
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-04

**Recommendation:** **A (segundo bootstrap NestJS, mesmo codebase, container próprio)** — reaproveita integralmente os padrões e a infraestrutura de código já validados nas Fases 01/02 (entidades, config, exceções de domínio), evitando duplicar lógica ou introduzir uma segunda stack só para chamar dois comandos de sistema (`ffprobe`/`ffmpeg`) que qualquer linguagem invoca da mesma forma trivial via `child_process`.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** **B (código curto dedicado + proxy autenticado)** — é a única combinação que atende ao requisito explícito de URL "curta" do `project-plan.md` sem abrir mão da checagem de posse a cada acesso (necessária enquanto não existe conceito de vídeo público/unlisted, que só chega na Fase 04). O custo adicional (uma dependência pequena e bem estabelecida, mais uma coluna com índice único) é baixo frente ao ganho de aderência ao requisito documentado.
**Libraries:** @aws-sdk/client-s3, nanoid

### phase-03-videos/TD-06

**Recommendation:** **B (enum simples + reprocessamento manual)** — atende ao requisito explícito do enunciado ("o que acontece em caso de falha no processamento") sem o custo de reupload de um arquivo grande, com uma adição pequena e bem contida (um endpoint) sobre a Option A. A Option C adiciona granularidade sem consumidor nesta fase — melhor avaliar quando a Fase 04 trouxer UI de progresso de upload.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — for a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) Architectural fit — the strict-BFF model already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match. (2) Smaller blast radius — a ~50-LOC session helper is grep-friendly, debuggable, test-friendly. (3) Compatibility with Next.js 16 / React 19 — built-in `next/headers` `cookies()` is the canonical primitive; Auth.js v5 lags behind Next.js majors. Option C rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive.
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) Defense in depth on cookie content — `httpOnly` blocks JS, encryption blocks accidental inspection. (2) Single cookie to manage simplifies logout and avoids orphan-cookie failure mode. (3) Room to carry minimal user metadata (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render authenticated chrome without a per-render `/auth/me` round-trip.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight refresh detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern rejected (doesn't replace server-side refresh). Option C's pre-emptive timer rejected (failure modes outweigh latency saving).
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) Decoupled from TD-05 — works with Route Handlers OR Server Actions. (2) Aligned with shadcn's canonical form primitive (`npx shadcn add form` produces react-hook-form wrappers). (3) Zod-first developer ergonomics match the rest of the FE foundation.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) Strict-BFF alignment — every mutation visible under `app/api/**`. (2) Test scaffold already exists for Route-Handlers-as-functions. (3) Single mutation surface — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) No first-render flicker, no round-trip — session delivered in the same response as page HTML. (2) No new BFF endpoint — cookie is source of truth, RSC reads it, Provider broadcasts it. `router.refresh()` after mid-session mutations is a small price.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) First-paint-correct — user sees the right outcome on first paint. (2) Single integration pattern across both flows — confirmation is RSC-only; reset is RSC + Client form. (3) Email-prefetch behavior solved at the backend's idempotent-confirmation level.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** É a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** O custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** Three reinforcing reasons. (1) Strict BFF makes the SDK surface valueless on the client — only Route Handlers ever call the upstream Nest; they already use `fetch`; a generated SDK adds a third client style to learn for zero functional gain. (2) Types-first matches the rest of the FE foundation — env validation is Zod-derived types; component variants are `cva` types; `paths` is the natural extension. (3) MSW typing is solved by the same `paths` symbol. The marginal cost of adding `openapi-fetch` is small enough to recommend the types + thin-client pair, not types alone.
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** Three reasons. (1) Preserves the compose-stack independence that `next-frontend-config-base/TD-03` calls out as the current architecture — neither subproject's compose file references the other. (2) Drift is eliminated structurally when paired with TD-03's CI freshness check. (3) The committed local file is a real artifact in PR review. Option A is acceptable as a pre-CI fallback; Option C is rejected because the cross-stack file dependency introduces coupling the current architecture explicitly avoids.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** It is the only option that makes contract drift both visible (in PR diffs) and impossible to merge accidentally (CI fail). The complexity premium over Option A is one CI step. Start at C; downgrading later is reversible (remove the CI step), upgrading later requires explaining generated-file history in a separate commit.
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** It is the only option that (i) handles pass-through and reshape with the same mechanism, (ii) gives a single grep target for "what shape does the BFF expose", and (iii) decouples Component imports from App Router file paths. Make `lib/api/contracts.ts` the only file that imports `paths` from `types.gen.ts`; every other consumer imports from `contracts.ts`.
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** Reasons: (1) Determinism over auto-generation — BFF integration tests assert on specific values; randomized fixtures are anti-helpful. (2) Coherence with TD-01 recommendation — `paths` is the single contract anchor, reused in MSW handlers. (3) Scale fit — Phase 02 introduces few endpoints; the manual cost is negligible at this stage.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Three converging reasons: (1) Type-inference matches the FE's strict-TS culture — `lib/env.ts` exports a typed `env` object with no `as` casts. (2) Ecosystem gravity in Next.js / React 19 — Zod is the de-facto schema language for App Router. (3) Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`) — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** The only option that combines (i) type-level `NEXT_PUBLIC_` prefix enforcement, (ii) runtime Proxy-based leak detection, and (iii) single-file, single-import-path consumer ergonomics. Option B reaches roughly the same structural outcome at higher cost with a weaker guarantee; Option C is unsafe at any non-trivial team size.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer.
**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** Three reasons. (1) MSW's own best-practice recommends it. (2) Domain ownership tracks the codebase, not the project plan — handler files mirror `components/`/`app/api/` domain vocabulary and remain stable as phases come and go. (3) Append-only growth with minimal merge conflicts. Option A is acceptable through Phase 02 alone but accumulates costs that B avoids from day one.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** The browser worker is a future capability with no documented current consumer; wiring it now is speculative investment, and wiring it incoherently actively misleads developers into thinking interception works when it doesn't under strict BFF. Keeps the foundation minimal and non-breaking to extend.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** Reasons: (1) Option B's determinism + readability is the right baseline — every fixture in Phase 02 is naturally hand-written. (2) Bulk-collection cases will arrive (Phase 07 home page grid, Phase 06 comment threads) and inline hand-written lists of 20+ items are genuinely tedious. (3) Per-fixture local seeding eliminates the global-cursor pitfall that makes Option C structurally fragile.
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** The requirement "import only what it needs" is satisfied at the authoring layer by TD-01 (per-domain files). At the runtime layer, loading all handlers is the canonical MSW v2 model and imposes no cost on tests that don't fetch the extra URLs. `onUnhandledRequest: "error"` enforces that a phase's test cannot accidentally invoke a route outside its scope.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` w/ namespaced `registerAs()` factories, one file per domain in `src/config/`. _(from phase 01)_
- Env vars validated by a Joi schema (`env.validation.ts`), passed to `ConfigModule.forRoot()` w/ validation opts. _(from phase 01)_
- Config injected via `ConfigType<T>` + `@Inject(xxxConfig.KEY)`; factory usable as plain fn for non-DI (TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'`, then calls `databaseConfig()` directly as a plain fn. _(from phase 01)_
- DB connection params sourced from a single `databaseConfig` factory — never duplicated between `AppModule` & `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` (not forRoot) w/ useFactory → autoLoadEntities: true, synchronize: false. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|-----------|--------|-----------|---------|
| (empty on first assembly — plan-resolve appends rows as user marks capabilities) | | | |

## Testing Requirements

### nestjs-project

| Artifact created | Required tests |
|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache, queue client) | Unit: real lib with test config |
| Service with side-effect dep (email, storage, queue) | Integration: real capture service (Mailpit-style) or local/real adapter — never mock |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to framework) | E2E only |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

Source: `.claude/skills/testing-guide-nestjs-project/SKILL.md` §3 (Feature Implementation Checklist). Anti-pattern to respect: do not mock configured libs or side-effect dependencies that can run for real via Docker Compose (DB, storage, mail, queue) — use real instances/capture services in integration tests instead.
