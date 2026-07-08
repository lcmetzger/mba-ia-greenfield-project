# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 4/14 completed

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
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.6 — URLs de parte (POST /videos/:id/upload-parts)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.7 — Conclusão do upload (POST /videos/:id/complete)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.8 — FfmpegService: extração de metadados e geração de thumbnail
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

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
