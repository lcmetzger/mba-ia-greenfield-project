# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 1/14 completed

### SI-03.1 — Dependências, configuração e infraestrutura Docker
- **Status:** completed
- **Tests:** no tests (Infra) — regressão de 144 testes existentes verificada (141→144 passing após correção)
- **Observations:**
  - `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` viraram `Joi.required()` (mesmo padrão de `DB_USERNAME`/`DB_PASSWORD`) — quebrou 3 testes existentes em `env.validation.integration-spec.ts` que usavam env parcial; corrigido adicionando as duas chaves ao fixture `requiredEnv` do próprio arquivo.
  - Usado `nest start --watch --entryFile worker.main` para o dev script do worker em vez de configurar múltiplos projetos no `nest-cli.json` — mais simples, reaproveita o build único existente.
  - MinIO: `minio/minio` foi arquivado no Docker Hub (parou de publicar novas versões em 2025-10-23); pinado em `RELEASE.2025-09-07T16-13-09Z` (última tag oficial confirmada) em vez de `:latest`.

### SI-03.2 — StorageModule (wrapper S3/MinIO)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.3 — QueueModule (wrapper BullMQ/Redis)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.4 — Entidade Video, enum de status, migration e exceções de domínio
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

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
