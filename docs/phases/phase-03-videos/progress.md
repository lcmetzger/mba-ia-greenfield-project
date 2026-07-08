# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 8/14 completed

### SI-03.1 — Dependências, configuração e infraestrutura Docker
- **Status:** completed
- **Tests:** no tests (Infra) — regressão de 144 testes existentes verificada (141→144 passing após correção)
- **Observations:**
  - `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` viraram `Joi.required()` (mesmo padrão de `DB_USERNAME`/`DB_PASSWORD`) — quebrou 3 testes existentes em `env.validation.integration-spec.ts` que usavam env parcial; corrigido adicionando as duas chaves ao fixture `requiredEnv` do próprio arquivo.
  - Usado `nest start --watch --entryFile worker.main` para o dev script do worker em vez de configurar múltiplos projetos no `nest-cli.json` — mais simples, reaproveita o build único existente.
  - MinIO: `minio/minio` foi arquivado no Docker Hub (parou de publicar novas versões em 2025-10-23); pinado em `RELEASE.2025-09-07T16-13-09Z` (última tag oficial confirmada) em vez de `:latest`.

### SI-03.2 — StorageModule (wrapper S3/MinIO)
- **Status:** completed
- **Tests:** 6/6 passing (storage.keys.spec.ts: 2 unit, storage.module.spec.ts: 1 compilation, storage.service.integration-spec.ts: 3 integration reais contra MinIO)
- **Observations:**
  - Adicionado `StorageService.putObject` (não listado nas Technical actions originais da SI) — necessário para o worker (SI-03.9) subir o thumbnail via PUT direto, fora do fluxo multipart do vídeo original. Extensão natural do escopo "encapsular o S3Client atrás de um serviço de domínio" da própria SI.
  - Teste de multipart real usa uma única parte (last-part semantics do S3/MinIO não exige tamanho mínimo de 5MB), evitando payloads grandes só para exercitar o mecanismo.

### SI-03.3 — QueueModule (wrapper BullMQ/Redis)
- **Status:** completed
- **Tests:** 1/1 passing (queue.module.spec.ts — compilation contra Redis real)
- **Observations:** none

### SI-03.4 — Entidade Video, enum de status, migration e exceções de domínio
- **Status:** completed
- **Tests:** 9/9 passing (video.entity.integration-spec.ts: 5, videos.module.spec.ts: 1, migrations.integration-spec.ts: 3); suíte completa 158/158 sem regressão
- **Observations:**
  - Migration `CreateVideos1783522092690` gerada via `npm run migration:generate` e aplicada ao banco (`npm run migration:run`).
  - `migrations.integration-spec.ts` estendido para incluir a 3ª migration; fix loop (1 tentativa): fixtures de `short_code` nos testes excediam `varchar(12)` (corrigido) e `Promise.all` derrubando tabelas com FK entre si (`videos`→`channels`) causava deadlock no Postgres — trocado por drop sequencial.
  - `cleanAllTables` (helper compartilhado) estendido com `DELETE FROM "videos"` — seguro porque a tabela já é permanente no banco de dev/test desde a migration aplicada nesta SI.
  - Migration gerada pelo CLI veio com formatação fora do Prettier do projeto (aspas duplas, indentação) — corrigido com `eslint --fix`.

### SI-03.5 — Iniciação de upload (POST /videos)
- **Status:** completed
- **Tests:** 14/14 passing (short-code.util.spec.ts: 3, videos.service.spec.ts: 4, videos.service.integration-spec.ts: 2, videos.module.spec.ts: 1, test/videos.e2e-spec.ts: 4)
- **Observations:**
  - Adicionado `ChannelsService.findByUserId` (não estava na SI original) — necessário para resolver o canal do usuário autenticado; extensão natural do serviço que já é dono do domínio `Channel`.
  - `size_bytes` máximo de 10GB é verificado no `VideosService` (lança `FileTooLargeException` com `errorCode` próprio), não via `class-validator` no DTO — isso mantém o `errorCode: FILE_TOO_LARGE` do Error Catalog, em vez do genérico `VALIDATION_ERROR` que um `@Max` no DTO geraria.
  - Modo contínuo do `/implement` ativado a pedido do usuário — deixo de pausar entre SIs a partir de agora.
  - `test/videos.e2e-spec.ts` e `videos.service.spec.ts` tipados explicitamente (sem `any` solto) para passar no lint estrito do projeto — diverge levemente do padrão já usado em `test/auth.e2e-spec.ts` (que tem 48 erros de lint pré-existentes, fora do escopo desta fase, descobertos ao investigar este ponto).

### SI-03.6 — URLs de parte (POST /videos/:id/upload-parts)
- **Status:** completed
- **Tests:** 16/16 passing (videos.service.spec.ts: 9 unit total, test/videos.e2e-spec.ts: 7 e2e total)
- **Observations:**
  - Resolvida uma inconsistência interna do próprio plano: a Technical action da SI dizia "checa posse (VideoNotOwnedException)", mas o Error Catalog/API Contracts documentam `404 VIDEO_NOT_FOUND` (não 403) para posse errada em rotas por `id` interno (upload-parts/complete/detail/reprocess) — segui o Error Catalog (fonte de verdade mais específica) e criei `findOwnedVideoOrThrow` retornando sempre `VideoNotFoundException` para "não existe" ou "não é meu". As rotas por `shortCode` (stream/download) permanecem com a distinção 404 vs 403 conforme documentado.
  - Retrofit: adicionei documentação Swagger completa (`@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiResponse` por status) no `VideosController`, incluindo o endpoint `POST /videos` da SI-03.5 que tinha ficado sem — exigido por `nestjs-controllers.md` e não coberto na SI original.
  - `POST /videos/:id/upload-parts` usa `@HttpCode(HttpStatus.OK)` (200) — o padrão do NestJS para `@Post()` é 201, mas o plano documenta 200 para este endpoint (não cria um recurso novo).

### SI-03.7 — Conclusão do upload (POST /videos/:id/complete)
- **Status:** completed
- **Tests:** 26/26 passing (videos.service.spec.ts, videos.service.integration-spec.ts, videos.module.spec.ts, test/videos.e2e-spec.ts); suíte completa 176 unit + 92 integration + 62 e2e sem regressão
- **Observations:**
  - `VideosModule` passa a importar `QueueModule`; `VideosService` injeta a fila via `@InjectQueue`.
  - Teste de integração exercita o ciclo real completo (initiateUpload → PUT real via URL presignada → completeUpload) contra MinIO e Redis reais, verificando o job na fila via `queue.getJobs`.

### SI-03.8 — FfmpegService: extração de metadados e geração de thumbnail
- **Status:** completed
- **Tests:** 4/4 passing (ffmpeg.service.integration-spec.ts — ffmpeg/ffprobe reais, sem mocks)
- **Observations:**
  - Fixture `src/test/fixtures/sample-video.mp4` (2s, 320x240, h264+aac, ~30KB) gerada com `ffmpeg -f lavfi testsrc/sine` — sem depender de download externo, versionada no repo.
  - `generateThumbnail` recebe `atSeconds` como parâmetro do caller (não calcula `min(duration/2, 5s)` internamente) — esse cálculo fica a cargo do worker (SI-03.9), que já tem a duração extraída.

### SI-03.9 — Worker de processamento (consumer + bootstrap)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.10 — Endpoints de leitura (GET /videos, GET /videos/:id)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.11 — Streaming (GET /videos/:shortCode/stream)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.12 — Download (GET /videos/:shortCode/download)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.13 — Reprocessamento (POST /videos/:id/reprocess)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.14 — E2E de ciclo completo e atualização do CLAUDE.md
- **Status:** pending
- **Tests:** no tests
- **Observations:** none
