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

<!-- SIs will be written in Phase B -->

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

<!-- Dep Map will be written in Phase B -->

---

## Deliverables

<!-- Deliverables will be written in Phase B -->
