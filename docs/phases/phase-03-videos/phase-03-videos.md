---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-07T22:04:57-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-07T22:08:28-03:00"
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

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar upload de vídeos de até 10GB sem impacto na performance (pré-cadastro automático como rascunho, multipart direto ao object storage), processamento automático em segundo plano via fila (extração de duração/metadados e geração de thumbnail), URL única por vídeo, reprodução via streaming e download — com upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando e URLs únicas geradas como entregáveis.

---

## Step Implementations

### SI-03.1 — Dependências, configuração e infraestrutura Docker

**Description:** Instala as libs novas, cria os namespaces de config de storage/fila, adiciona MinIO/Redis/worker ao Compose e prepara o container para rodar `ffmpeg`/`ffprobe`.

**Technical actions:**

1. Instalar `@nestjs/bullmq`, `bullmq`, `ioredis`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `nanoid@^3.3.8` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, `phase-03-videos/TD-05`)
2. Criar `src/config/storage.config.ts` (`registerAs('storage', ...)` — endpoint, buckets, credenciais, tamanho de parte) e `src/config/queue.config.ts` (`registerAs('queue', ...)` — host/porta do Redis) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`)
3. Estender `src/config/env.validation.ts` (Joi) com as novas variáveis de storage/fila e atualizar `.env.example`
4. Adicionar `minio`, `minio-init` e `redis` (com healthcheck) e `video-worker` ao `compose.yaml`; adicionar `ffmpeg` ao `apt install` do `Dockerfile.dev` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-04`)
5. Configurar um segundo entry point de worker (`start:worker:dev` no `package.json`) reaproveitando a mesma imagem/volume do serviço `nestjs-api` (per `phase-03-videos/TD-04`)

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` sobe `minio`, `redis` e `video-worker` junto com os serviços já existentes, todos com status "running"
- `docker compose exec nestjs-api sh -c "which ffmpeg && which ffprobe"` retorna os caminhos dos dois binários
- A aplicação falha ao subir quando uma variável de storage/fila obrigatória está ausente (validação Joi)
- `.env.example` documenta todas as novas variáveis de storage e fila

---

### SI-03.2 — StorageModule (wrapper S3/MinIO)

**Description:** Encapsula o `S3Client` apontando para o MinIO atrás de um serviço de domínio, seguindo o padrão já usado por `MailModule`/`MailService`.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` — provider de `S3Client` via factory (`endpoint`, `forcePathStyle: true`, credenciais) injetando `storage.config.ts` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`)
2. Criar `src/storage/storage.service.ts` — `createMultipartUpload`, `presignUploadPart`, `completeMultipartUpload`, `headObject`, `getObjectStream(key, range)` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-05`)
3. Criar `src/storage/storage.keys.ts` — util puro de construção de chave (`videos/{videoId}/original`, `thumbnails/{videoId}/thumbnail.jpg`) (per `phase-03-videos/TD-02`)
4. Criar `src/test/minio.ts` — helper de teste contra o MinIO real (limpar bucket, put/get de objeto), no mesmo padrão de `src/test/mailpit.ts`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `storage.keys.ts` | Unit: geração de chave por `videoId` | `storage.keys.spec.ts` |
| `StorageService` | Integration: multipart real contra MinIO (create/presign/complete/head/get com Range) | `storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilation test | `storage.module.spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `StorageService.createMultipartUpload` retorna um `uploadId` válido do MinIO real
- `StorageService.presignUploadPart` gera uma URL que aceita um `PUT` real de bytes de teste
- `StorageService.completeMultipartUpload` com ETags válidos finaliza o objeto no bucket
- `StorageService.getObjectStream` com um `Range` retorna apenas o trecho de bytes solicitado

---

### SI-03.3 — QueueModule (wrapper BullMQ/Redis)

**Description:** Encapsula a conexão BullMQ/Redis atrás de um módulo compartilhado, reutilizável tanto pela API (producer) quanto pelo worker (consumer).

**Technical actions:**

1. Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync` com conexão Redis via `queue.config.ts` (per `phase-03-videos/TD-01`)
2. Criar `src/queue/queue.constants.ts` — nome da fila `VIDEO_PROCESSING_QUEUE` e nome do job `process-video` (per `phase-03-videos/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `QueueModule` | Unit: compilation test | `queue.module.spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `QueueModule` compila e resolve a conexão Redis real do Compose (serviço `redis`, nunca `localhost`)
- `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })` fica disponível para injeção via `@InjectQueue`

---

### SI-03.4 — Entidade Video, enum de status, migration e exceções de domínio

**Description:** Cria o modelo de persistência do vídeo (colunas, relação com `Channel`, migration) e as exceções de domínio novas usadas pelo restante da fase.

**Technical actions:**

1. Criar `src/videos/entities/video-status.enum.ts` — `VideoStatus` (`draft`, `processing`, `ready`, `error`) (per `phase-03-videos/TD-06`)
2. Criar `src/videos/entities/video.entity.ts` — colunas per `### Data Model → Video` (`id`, `channel_id`, `title`, `status`, `short_code`, `storage_key`, `thumbnail_key`, `upload_id`, `original_filename`, `content_type`, `size_bytes`, `duration_seconds`, `metadata`, `error_message`, `processed_at`, `created_at`, `updated_at`), `@ManyToOne(() => Channel)` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-05`, `phase-03-videos/TD-06`)
3. Criar `src/videos/videos.module.ts` — `TypeOrmModule.forFeature([Video])`
4. Gerar a migration `CreateVideos` via `npm run migration:generate` — tabela `videos`, índice único em `short_code`, índices em `channel_id` e `status`, FK para `channels`
5. Adicionar `VideoNotFoundException`, `VideoNotOwnedException`, `VideoNotReadyException`, `VideoNotDraftException`, `VideoNotErrorException`, `UploadInitiationFailedException`, `UploadCompletionFailedException`, `FileTooLargeException`, `ChannelNotFoundException` em `src/common/exceptions/domain.exception.ts` (per `### Error Catalog`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` entity | Integration: constraints, defaults, unicidade de `short_code` | `video.entity.integration-spec.ts` |
| Migration `CreateVideos` | Integration: aplica e reverte, cria a tabela `videos` | `migrations.integration-spec.ts` (estende o já existente) |
| `VideosModule` | Unit: compilation test | `videos.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- A migration `CreateVideos` cria a tabela `videos` com todas as colunas do Data Model
- Duas tentativas de `INSERT` com o mesmo `short_code` violam a constraint `UNIQUE`
- `npm run migration:revert` remove a tabela `videos` sem afetar `channels`/`users`

---

### SI-03.5 — Iniciação de upload (POST /videos)

**Description:** Pré-cadastra o vídeo como rascunho e inicia o multipart upload no object storage, devolvendo os identificadores que o cliente precisa para enviar as partes.

**Technical actions:**

1. Criar `src/videos/dto/initiate-upload.dto.ts` — `title`, `content_type`, `size_bytes` (max `10737418240`), `original_filename`, com `class-validator` (per `### API Contracts → POST /videos`, `### Error Catalog → FILE_TOO_LARGE`)
2. Criar `src/videos/short-code.util.ts` — `generateShortCode` via `customAlphabet` do `nanoid` (12 caracteres, alfabeto alfanumérico) (per `phase-03-videos/TD-05`)
3. Implementar `VideosService.initiateUpload` — resolve o canal do usuário autenticado, gera `short_code`, cria `Video` com `status=draft`, chama `StorageService.createMultipartUpload`, persiste `storage_key`/`upload_id` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`)
4. Criar `src/videos/videos.controller.ts` com `POST /videos` (autenticado por padrão via guard global, sem `@Public()`), retorna `201` (per `### API Contracts`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `short-code.util.ts` | Unit: geração de código, alfabeto, tamanho | `short-code.util.spec.ts` |
| `VideosService.initiateUpload` | Unit: branch logic (mock repo + storage) | `videos.service.spec.ts` |
| `VideosService.initiateUpload` | Integration: DB + MinIO reais | `videos.service.integration-spec.ts` |
| `POST /videos` | E2E: sucesso, validação, canal ausente | `test/videos.e2e-spec.ts` |

**Dependencies:** SI-03.2, SI-03.4

**Acceptance criteria:**

- `POST /videos` com corpo válido retorna `201` com `id`, `short_code`, `upload_id` e `status: "draft"`
- `POST /videos` com `size_bytes` acima de 10GB retorna `400` com `errorCode: "FILE_TOO_LARGE"`
- Dois vídeos criados em sequência recebem `short_code` distintos
- O `Video` criado aparece no banco com `status=draft` e `storage_key` preenchido

---

### SI-03.6 — URLs de parte (POST /videos/:id/upload-parts)

**Description:** Devolve URLs pré-assinadas de `PUT` para as partes solicitadas do multipart upload, reexecutável para permitir retomada de partes que falharem.

**Technical actions:**

1. Criar `src/videos/dto/upload-parts.dto.ts` — `part_numbers: number[]` (inteiros entre 1 e 10000) (per `### API Contracts → POST /videos/:id/upload-parts`)
2. Implementar `VideosService.getUploadPartUrls` — checa posse (`VideoNotOwnedException`) e `status=draft` (`VideoNotDraftException`), chama `StorageService.presignUploadPart` por parte (per `phase-03-videos/TD-03`)
3. Adicionar `POST /videos/:id/upload-parts` ao `VideosController` (per `### API Contracts`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getUploadPartUrls` | Unit: branch logic | `videos.service.spec.ts` (estende) |
| `POST /videos/:id/upload-parts` | E2E: sucesso, vídeo inexistente, fora de `draft` | `test/videos.e2e-spec.ts` (estende) |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- `POST /videos/:id/upload-parts` com `part_numbers: [1, 2]` retorna `200` com duas URLs pré-assinadas distintas
- Chamar o endpoint duas vezes para o mesmo `part_number` retorna URLs válidas em ambas as chamadas (reexecutável)
- Chamar o endpoint para um vídeo com `status != draft` retorna `409` com `errorCode: "VIDEO_NOT_DRAFT"`
- Chamar o endpoint para um vídeo de outro canal retorna `404`

---

### SI-03.7 — Conclusão do upload (POST /videos/:id/complete)

**Description:** Finaliza o multipart upload no storage, transiciona o vídeo para `processing` e enfileira o job de processamento.

**Technical actions:**

1. Criar `src/videos/dto/complete-upload.dto.ts` — `parts: { part_number, etag }[]`, obrigatório (per `### API Contracts → POST /videos/:id/complete`)
2. Implementar `VideosService.completeUpload` — checa posse + `status=draft`, chama `StorageService.completeMultipartUpload`, valida o objeto via `headObject`, transiciona `draft → processing`, publica o job `video.process` na fila (per `phase-03-videos/TD-03`, `phase-03-videos/TD-01`, `phase-03-videos/TD-06`, `### Events/Messages → video.process`)
3. Adicionar `POST /videos/:id/complete` ao `VideosController` (per `### API Contracts`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: branch logic (mock storage + fila) | `videos.service.spec.ts` (estende) |
| `VideosService.completeUpload` | Integration: MinIO + Redis reais, job publicado na fila | `videos.service.integration-spec.ts` (estende) |
| `POST /videos/:id/complete` | E2E: sucesso, fora de `draft` | `test/videos.e2e-spec.ts` (estende) |

**Dependencies:** SI-03.6, SI-03.3

**Acceptance criteria:**

- `POST /videos/:id/complete` com ETags válidos retorna `200` com `status: "processing"`
- Após a chamada, o `Video` no banco tem `status=processing`
- Um job `video.process` com o `videoId` correto aparece na fila `VIDEO_PROCESSING_QUEUE` real (verificável via `queue.getJobs(['waiting', 'active'])`)
- Chamar o endpoint para um vídeo que não está em `draft` retorna `409` com `errorCode: "VIDEO_NOT_DRAFT"`

---

### SI-03.8 — FfmpegService: extração de metadados e geração de thumbnail

**Description:** Encapsula as chamadas de sistema a `ffprobe`/`ffmpeg` usadas pelo worker para extrair metadados e gerar o thumbnail.

**Technical actions:**

1. Criar `src/video-processing/ffmpeg.service.ts` — `extractMetadata(path)` via `child_process.execFile('ffprobe', ...)` parseando duração/largura/altura/codec/bitrate; `generateThumbnail(path, outPath, atSeconds)` via `child_process.execFile('ffmpeg', ...)` (per `phase-03-videos/TD-04`)
2. Adicionar um fixture de vídeo curto versionado em `src/test/fixtures/sample-video.mp4`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfmpegService.extractMetadata` | Integration: `ffprobe` real sobre o fixture | `ffmpeg.service.integration-spec.ts` |
| `FfmpegService.generateThumbnail` | Integration: `ffmpeg` real gera `.jpg` sobre o fixture | `ffmpeg.service.integration-spec.ts` (mesmo arquivo) |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `extractMetadata` sobre o fixture retorna `duration`, `width`, `height` e `codec` com valores coerentes com o arquivo real
- `generateThumbnail` sobre o fixture produz um arquivo `.jpg` válido e não vazio no caminho de saída
- `extractMetadata` sobre um arquivo corrompido/inválido rejeita a promise com um erro identificável

---

### SI-03.9 — Worker de processamento (consumer + bootstrap)

**Description:** Segundo bootstrap NestJS (sem HTTP) que consome a fila de processamento e executa o pipeline completo: baixar o original, extrair metadados, gerar thumbnail, subir o thumbnail e atualizar o status do vídeo.

**Technical actions:**

1. Criar `src/video-processing/video-processing.module.ts` — importa `StorageModule`, `QueueModule`, `TypeOrmModule.forFeature([Video])` (per `phase-03-videos/TD-04`)
2. Criar `src/video-processing/video-processing.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)`; `process()` baixa o original para `/tmp`, chama `FfmpegService`, sobe o thumbnail via `StorageService`, atualiza `Video` (`status=ready` + `duration_seconds`/`metadata`/`processed_at`); `@OnWorkerEvent('failed')` grava `status=error` + `error_message` somente quando `job.attemptsMade >= job.opts.attempts` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`, `phase-03-videos/TD-06`, `### Events/Messages → video.process`)
3. Criar `src/worker.module.ts` — importa `ConfigModule`, `TypeOrmModule`, `VideoProcessingModule` (sem `AuthModule`) (per `phase-03-videos/TD-04`)
4. Criar `src/worker.main.ts` — `NestFactory.createApplicationContext(WorkerModule)`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProcessor.process` | Integration: pipeline completo real (MinIO + Redis + `ffmpeg`) sobre o fixture — sucesso transiciona para `ready` | `video-processing.processor.integration-spec.ts` |
| `VideoProcessingProcessor` | Integration: falha esgota as tentativas — transiciona para `error` com `error_message` | `video-processing.processor.integration-spec.ts` (mesmo arquivo) |
| `VideoProcessingModule` | Unit: compilation test | `video-processing.module.spec.ts` |

**Dependencies:** SI-03.7, SI-03.8

**Acceptance criteria:**

- Um job `video.process` válido processado pelo worker real deixa o `Video` com `status=ready`, `duration_seconds` e `thumbnail_key` preenchidos
- Um job cujo processamento falha em todas as tentativas deixa o `Video` com `status=error` e `error_message` preenchido
- Um job que falha na primeira tentativa mas sucede em uma tentativa de retry não deixa o vídeo em `error`
- O worker consome a fila `VIDEO_PROCESSING_QUEUE` real do Compose, sem qualquer mock de Redis/MinIO/`ffmpeg`

---

### SI-03.10 — Endpoints de leitura (GET /videos, GET /videos/:id)

**Description:** Lista os vídeos do canal do usuário autenticado e expõe o detalhe de um vídeo por id, usado para polling de status.

**Technical actions:**

1. Implementar `VideosService.listByChannel` e `VideosService.findById` (checa posse) (per `### API Contracts`)
2. Adicionar `GET /videos` e `GET /videos/:id` ao `VideosController` (per `### API Contracts`, `### Authorization Matrix`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `GET /videos` | E2E: retorna apenas os vídeos do canal do usuário autenticado | `test/videos.e2e-spec.ts` (estende) |
| `GET /videos/:id` | E2E: sucesso, vídeo inexistente/de outro canal | `test/videos.e2e-spec.ts` (estende) |

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `GET /videos` autenticado como o dono do canal A não retorna vídeos do canal B
- `GET /videos/:id` para um vídeo do próprio canal retorna `200` com os campos do Data Model
- `GET /videos/:id` para um vídeo de outro canal retorna `404`

---

### SI-03.11 — Streaming (GET /videos/:shortCode/stream)

**Description:** Reproduz o vídeo via proxy autenticado pela API, respeitando requisições `Range` com resposta `206 Partial Content`.

**Technical actions:**

1. Implementar `VideosService.resolveByShortCode` — busca por `short_code`, checa posse (`VideoNotOwnedException`) e `status=ready` (`VideoNotReadyException`) (per `### Authorization Matrix`, `### Error Catalog`)
2. Implementar `VideosController.stream` — parseia o header `Range`, chama `StorageService.getObjectStream`, faz *pipe* da resposta com `200`/`206` + `Content-Range`/`Content-Length`/`Accept-Ranges` (per `phase-03-videos/TD-05`, `### API Contracts`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `GET /videos/:shortCode/stream` | Integration: proxy real contra MinIO, `Range` parcial retorna os bytes corretos | `videos.streaming.integration-spec.ts` |
| `GET /videos/:shortCode/stream` | E2E: `200` sem `Range`, `206` com `Range`, posse, status | `test/videos.e2e-spec.ts` (estende) |

**Dependencies:** SI-03.2, SI-03.9

**Acceptance criteria:**

- `GET /videos/:shortCode/stream` sem header `Range` retorna `200` com o corpo completo do vídeo
- `GET /videos/:shortCode/stream` com `Range: bytes=0-99` retorna `206` com exatamente 100 bytes e `Content-Range` correto
- `GET /videos/:shortCode/stream` de um vídeo de outro canal retorna `403` com `errorCode: "VIDEO_NOT_OWNED"`
- `GET /videos/:shortCode/stream` de um vídeo com `status != ready` retorna `409` com `errorCode: "VIDEO_NOT_READY"`

---

### SI-03.12 — Download (GET /videos/:shortCode/download)

**Description:** Permite o download do arquivo completo, reaproveitando o mesmo mecanismo de proxy autenticado de SI-03.11, com `Content-Disposition: attachment`.

**Technical actions:**

1. Implementar `VideosController.download` — mesmo proxy de leitura de SI-03.11, adicionando `Content-Disposition: attachment; filename="{título sanitizado}.{ext}"` (per `### API Contracts`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `GET /videos/:shortCode/download` | E2E: `Content-Disposition` correto, posse, status | `test/videos.e2e-spec.ts` (estende) |

**Dependencies:** SI-03.11

**Acceptance criteria:**

- `GET /videos/:shortCode/download` de um vídeo `ready` retorna `200` com header `Content-Disposition: attachment` contendo o título do vídeo
- `GET /videos/:shortCode/download` de um vídeo de outro canal retorna `403` com `errorCode: "VIDEO_NOT_OWNED"`
- `GET /videos/:shortCode/download` de um vídeo com `status != ready` retorna `409` com `errorCode: "VIDEO_NOT_READY"`

---

### SI-03.13 — Reprocessamento (POST /videos/:id/reprocess)

**Description:** Permite reenfileirar o processamento de um vídeo em `error` sem exigir um novo upload, já que o objeto original permanece íntegro no storage.

**Technical actions:**

1. Implementar `VideosService.reprocess` — checa posse + `status=error`, reseta para `processing`, republica o job `video.process` (per `phase-03-videos/TD-06`, `### Events/Messages`)
2. Adicionar `POST /videos/:id/reprocess` ao `VideosController` (per `### API Contracts`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.reprocess` | Unit: branch logic | `videos.service.spec.ts` (estende) |
| `POST /videos/:id/reprocess` | E2E: sucesso, fora de `error` | `test/videos.e2e-spec.ts` (estende) |

**Dependencies:** SI-03.9

**Acceptance criteria:**

- `POST /videos/:id/reprocess` em um vídeo `error` retorna `200` com `status: "processing"` e reenfileira o job sem exigir novo upload
- `POST /videos/:id/reprocess` em um vídeo que não está em `error` retorna `409` com `errorCode: "VIDEO_NOT_ERROR"`
- Após o reprocessamento bem-sucedido pelo worker, o vídeo volta a `status=ready`

---

### SI-03.14 — E2E de ciclo completo e atualização do CLAUDE.md

**Description:** Cobre o fluxo ponta a ponta real (upload → processamento → streaming/download) e atualiza a documentação de IA do projeto com o estado real do código desta fase.

**Technical actions:**

1. Escrever `test/videos-lifecycle.e2e-spec.ts` — fluxo completo real: `POST /videos` → `upload-parts` → `PUT` direto ao MinIO → `complete` → aguardar o worker processar (poll em `GET /videos/:id` até `ready`) → `GET .../stream` com `Range` → `GET .../download`
2. Atualizar `nestjs-project/CLAUDE.md` e o `CLAUDE.md` raiz com a seção de vídeos (módulo, endpoints, fila/worker, storage), refletindo o código real desta fase

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Ciclo completo upload → processamento → streaming → download | E2E real (worker rodando, sem mocks) | `test/videos-lifecycle.e2e-spec.ts` |

**Dependencies:** SI-03.10, SI-03.12, SI-03.13

**Acceptance criteria:**

- O teste de ciclo completo sobe um vídeo pequeno real, aguarda `status=ready` via polling e reproduz um trecho via `Range` com sucesso
- `nestjs-project/CLAUDE.md` documenta o módulo `videos`, os endpoints, a fila/worker e o storage sem citar arquivos ou comportamentos inexistentes
- `CLAUDE.md` raiz reflete a Fase 03 como implementada

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| channel_id | uuid | FK -> channels(id), not null |
| title | varchar(200) | not null |
| status | enum('draft', 'processing', 'ready', 'error') | not null, default 'draft' |
| short_code | varchar(12) | unique, not null |
| storage_key | varchar | not null |
| thumbnail_key | varchar | nullable |
| upload_id | varchar | nullable |
| original_filename | varchar | nullable |
| content_type | varchar | nullable |
| size_bytes | bigint | nullable |
| duration_seconds | numeric | nullable |
| metadata | jsonb | nullable |
| error_message | text | nullable |
| processed_at | timestamptz | nullable |
| created_at | timestamptz | not null, default now() |
| updated_at | timestamptz | not null, default now() |

**Relations:** `Video` belongs to `Channel` (many-to-one — um canal pode ter muitos vídeos)
**Indexes:** unique on `short_code`; index on `channel_id`; index on `status`

_`status` cobre apenas o ciclo técnico de upload/processamento desta fase (draft → processing → ready/error) — não representa "publicado"; visibilidade/publicação são responsabilidade da Fase 04 (per esclarecimento AMB-1 em `validation.md`)._

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- title: string, required — min 1, max 200 caracteres
- content_type: string, required — MIME type declarado do arquivo (ex.: video/mp4)
- size_bytes: number, required — tamanho declarado do arquivo, max 10737418240 (10GB)
- original_filename: string, required

**Response 201:**
- id: string (uuid)
- short_code: string
- upload_id: string
- status: "draft"

**Error responses:**
- 400 validation error: quando `size_bytes` excede 10GB ou campos obrigatórios ausentes
- 404 CHANNEL_NOT_FOUND: quando o usuário autenticado não possui canal associado
- 502 UPLOAD_INITIATION_FAILED: quando o object storage falha ao iniciar o multipart upload

---

#### POST /videos/:id/upload-parts (SI-03.6)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- part_numbers: number[], required — números de parte (1 a 10000) para os quais gerar URL pré-assinada

**Response 200:**
- parts: array de `{ part_number: number, url: string }`

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou não pertence ao canal do usuário
- 409 VIDEO_NOT_DRAFT: quando o vídeo não está em `status=draft`
- 400 validation error: quando `part_numbers` está vazio ou fora do intervalo válido

---

#### POST /videos/:id/complete (SI-03.7)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- parts: array de `{ part_number: number, etag: string }`, required

**Response 200:**
- id: string (uuid)
- status: "processing"

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 VIDEO_NOT_DRAFT
- 502 UPLOAD_COMPLETION_FAILED: quando o object storage rejeita a finalização (ETags inválidos, partes faltando)

---

#### GET /videos (SI-03.10)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- items: array de `{ id, short_code, title, status, duration_seconds, created_at }` — apenas os vídeos do canal do usuário autenticado

---

#### GET /videos/:id (SI-03.10)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- id, short_code, title, status, duration_seconds, metadata, error_message, created_at, updated_at

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou não pertence ao canal do usuário

---

#### GET /videos/:shortCode/stream (SI-03.11)

**Request headers:**
- Authorization: Bearer {access_token}
- Range: bytes=start-end (opcional)

**Response 200:** corpo completo do vídeo, quando o header `Range` está ausente.

**Response 206:** trecho solicitado, com `Content-Range`, `Content-Length` e `Accept-Ranges: bytes`, quando o header `Range` está presente.

**Error responses:**
- 404 VIDEO_NOT_FOUND: `shortCode` inexistente
- 403 VIDEO_NOT_OWNED: vídeo não pertence ao canal do usuário autenticado
- 409 VIDEO_NOT_READY: quando `status != ready`

---

#### GET /videos/:shortCode/download (SI-03.12)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:** corpo completo do vídeo, com `Content-Disposition: attachment; filename="{título sanitizado}.{ext}"`.

**Error responses:**
- 404 VIDEO_NOT_FOUND: `shortCode` inexistente
- 403 VIDEO_NOT_OWNED: vídeo não pertence ao canal do usuário autenticado
- 409 VIDEO_NOT_READY: quando `status != ready`

---

#### POST /videos/:id/reprocess (SI-03.13)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- id: string (uuid)
- status: "processing"

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 VIDEO_NOT_ERROR: quando `status != error`

---

#### Validation Rules — Videos

- `title`: required, min 1, max 200 caracteres
- `content_type`: required, string
- `size_bytes`: required, number, max 10737418240 (10GB) — rejeitado com `FILE_TOO_LARGE` quando excedido
- `part_numbers` / `parts[].part_number`: required, integer entre 1 e 10000
- `parts[].etag`: required, string

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner (dono do canal do vídeo) |
|----------|-----------|----------------|---------------------------------|
| POST /videos | ✗ | ✓ | — (canal resolvido a partir do usuário autenticado) |
| POST /videos/:id/upload-parts | ✗ | ✓ | ✓ |
| POST /videos/:id/complete | ✗ | ✓ | ✓ |
| GET /videos | ✗ | ✓ | — (lista apenas os vídeos do próprio canal) |
| GET /videos/:id | ✗ | ✓ | ✓ |
| GET /videos/:shortCode/stream | ✗ | ✓ | ✓ |
| GET /videos/:shortCode/download | ✗ | ✓ | ✓ |
| POST /videos/:id/reprocess | ✗ | ✓ | ✓ |

_Sem conceito de vídeo público/unlisted nesta fase — todo acesso a streaming/download exige que o usuário autenticado seja o dono do canal do vídeo (per esclarecimento AMB-2 em `validation.md`; visibilidade pública/unlisted chega na Fase 04)._

### Error Catalog

_Formato de resposta de erro herdado de `phase-02-auth/TD-07` (`{ statusCode, error, message }`, via `DomainExceptionFilter`) — não redefinido nesta fase, apenas os códigos de domínio novos abaixo._

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| CHANNEL_NOT_FOUND | 404 | Usuário autenticado sem canal associado ao iniciar upload |
| FILE_TOO_LARGE | 400 | `size_bytes` declarado excede 10GB |
| UPLOAD_INITIATION_FAILED | 502 | Falha ao iniciar multipart upload no object storage |
| VIDEO_NOT_FOUND | 404 | Vídeo inexistente, ou `id`/`shortCode` não corresponde a nenhum vídeo do canal |
| VIDEO_NOT_OWNED | 403 | Vídeo não pertence ao canal do usuário autenticado |
| VIDEO_NOT_DRAFT | 409 | `upload-parts`/`complete` chamados fora do `status=draft` |
| UPLOAD_COMPLETION_FAILED | 502 | Falha ao finalizar multipart upload (ETags inválidos, partes faltando) |
| VIDEO_NOT_READY | 409 | Streaming/download solicitado com `status != ready` |
| VIDEO_NOT_ERROR | 409 | Reprocessamento solicitado com `status != error` |

### Events/Messages

#### video.process

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-06`)
**Consumer:** `VideoProcessingProcessor` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`)
**Trigger:** Emitido por `POST /videos/:id/complete` ao finalizar o multipart upload com sucesso, e por `POST /videos/:id/reprocess` ao reenfileirar um vídeo em `status=error`.
**Delivery semantics:** at-least-once, com retry automático (3 tentativas, backoff exponencial a partir de 5s) — `status=error` só é gravado após esgotar as tentativas (per `phase-03-videos/TD-01`, `phase-03-videos/TD-06`). Jobs que esgotam as tentativas ficam retidos na fila "failed" do BullMQ, funcionando como DLQ para inspeção manual sem infraestrutura extra.

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-03.1 (root)
├── SI-03.2 — depends on SI-03.1 (StorageModule precisa da config/infra de storage)
│   └── SI-03.11 — depends on SI-03.2, SI-03.9 (streaming precisa do storage e de um vídeo ready)
│       └── SI-03.12 — depends on SI-03.11 (download reaproveita o proxy do streaming)
├── SI-03.3 — depends on SI-03.1 (QueueModule precisa da config/infra de fila)
├── SI-03.8 — depends on SI-03.1 (FfmpegService precisa do ffmpeg/ffprobe no container)
SI-03.4 (root, independente)
└── SI-03.5 — depends on SI-03.2, SI-03.4 (iniciação de upload precisa de storage + entidade)
    └── SI-03.6 — depends on SI-03.5 (URLs de parte seguem a iniciação)
        └── SI-03.7 — depends on SI-03.6, SI-03.3 (conclusão do upload precisa da fila)
            └── SI-03.9 — depends on SI-03.7, SI-03.8 (worker consome o job publicado na conclusão)
                ├── SI-03.13 — depends on SI-03.9 (reprocessamento reenfileira o mesmo job)
                └── SI-03.14 — depends on SI-03.10, SI-03.12, SI-03.13 (E2E de ciclo completo fecha a fase)
SI-03.10 — depends on SI-03.4 (leitura só precisa da entidade)
```

Ordem linearizada de implementação: SI-03.1 → SI-03.2 / SI-03.3 / SI-03.8 (paralelizáveis) → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7 → SI-03.9 → SI-03.10 / SI-03.11 → SI-03.12 / SI-03.13 → SI-03.14.

---

## Deliverables

- [ ] SI-03.1 — Dependências, configuração e infraestrutura Docker
- [ ] SI-03.2 — StorageModule (wrapper S3/MinIO)
- [ ] SI-03.3 — QueueModule (wrapper BullMQ/Redis)
- [ ] SI-03.4 — Entidade Video, enum de status, migration e exceções de domínio
- [ ] SI-03.5 — Iniciação de upload (POST /videos)
- [ ] SI-03.6 — URLs de parte (POST /videos/:id/upload-parts)
- [ ] SI-03.7 — Conclusão do upload (POST /videos/:id/complete)
- [ ] SI-03.8 — FfmpegService: extração de metadados e geração de thumbnail
- [ ] SI-03.9 — Worker de processamento (consumer + bootstrap)
- [ ] SI-03.10 — Endpoints de leitura (GET /videos, GET /videos/:id)
- [ ] SI-03.11 — Streaming (GET /videos/:shortCode/stream)
- [ ] SI-03.12 — Download (GET /videos/:shortCode/download)
- [ ] SI-03.13 — Reprocessamento (POST /videos/:id/reprocess)
- [ ] SI-03.14 — E2E de ciclo completo e atualização do CLAUDE.md

**Full test suites:**

- [ ] Testes unitários passam (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] Testes de integração passam (`docker compose exec nestjs-api npm run test:integration`)
- [ ] Testes E2E passam (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type-check passa (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passa (`docker compose exec nestjs-api npm run lint`)
