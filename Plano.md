# Plano de Implementação — Fase 03: Upload e Processamento de Vídeos

> Plano passo a passo derivado de [ENUNCIADO.md](./ENUNCIADO.md). Segue o workflow research → planejamento → implementação já usado nas Fases 01/02 (ver `docs/phases/phase-02-auth/` como referência de formato) e as skills registradas em `.claude/skills/`.

## Status geral

- [ ] Etapa 0 — Setup e baseline
- [ ] Etapa 1 — Research (decisões técnicas)
- [ ] Etapa 2 — Planejamento (pipeline)
- [ ] Etapa 3 — Implementação (SI a SI)
- [ ] Etapa 4 — Fechamento (Definition of Done + documentação)

---

## Etapa 0 — Setup e baseline

- [ ] Confirmar/criar o fork público do repositório base (`https://github.com/devfullcycle/mba-ia-greenfield-project`) e trabalhar dentro dele (não criar repositório novo).
- [ ] Garantir que existe a branch `dev` e criar a branch de trabalho a partir dela: `feature/phase-03-videos` (Git Flow — nunca commitar direto na `main`).
- [ ] Subir o backend atual: `cd nestjs-project && docker compose up -d` (sobe `nestjs-api`, `db` Postgres 17, `mailpit`).
- [ ] Instalar dependências (`npm install`) e rodar as migrations existentes (`npm run migration:run`).
- [ ] Rodar a suíte atual e confirmar baseline verde antes de mexer em qualquer coisa:
  - [ ] `npm test`
  - [ ] `npm run test:integration`
  - [ ] `npm run test:e2e`
  - [ ] `npx tsc --noEmit`
  - [ ] `npm run lint`
- [ ] Se for usar outra ferramenta agêntica que não o Claude Code (Gemini CLI, Codex etc.): portar `CLAUDE.md` → arquivo equivalente, skills/sub-agents → mecanismo equivalente, `.mcp.json` → configuração de MCP da ferramenta escolhida, **antes** de começar a Etapa 1.

---

## Etapa 1 — Research: decisões técnicas em aberto

Artefato: `docs/decisions/technical-decisions-phase-03-videos.md`
Comando: `/research` (skill `research`), no formato dos documentos de decisão existentes (ver `docs/decisions/technical-decisions-phase-02-auth.md` como referência).

Decisões que o research precisa fechar, com opções, trade-offs e recomendação para cada uma:

- [ ] **Tecnologia de fila** — hoje "TBD" no `docs/project-plan.md`. É a principal decisão de stack da fase (ex.: BullMQ + Redis, RabbitMQ, SQS-like via MinIO/other). Justificar a escolha considerando que tudo deve rodar via Docker Compose.
- [ ] **Estratégia de upload de 10GB sem travar a API** — avaliar upload direto ao object storage via URL pré-assinada / multipart upload, versus qualquer alternativa que faça o arquivo passar pela API (a ser descartada).
- [ ] **Como o worker roda** — processo/container separado no `compose.yaml`; como extrai metadados (ffprobe) e gera thumbnail (FFmpeg) a partir de um frame do vídeo.
- [ ] **Estratégia de URL única e de streaming** — geração de identificador único por vídeo; suporte a streaming via requisições com `Range` / resposta `206 Partial Content`.
- [ ] **Ciclo de status do vídeo** — estados (rascunho → processando → pronto/erro) e comportamento em caso de falha no processamento.
- [ ] **Uso do object storage (não é decisão de qual storage)** — o storage já é dado: MinIO local em Docker (compatível com S3), trocável por S3 em produção. Decidir apenas organização de buckets/chaves e o fluxo de upload pré-assinado.

Checklist de saída da etapa:

- [ ] Documento salvo em `docs/decisions/technical-decisions-phase-03-videos.md`.
- [ ] Cada decisão tem opções avaliadas, trade-offs e recomendação justificada.
- [ ] Nenhuma decisão da lista acima ficou em aberto ("TBD") ao final.

---

## Etapa 2 — Planejamento (pipeline)

Pasta da fase: `docs/phases/phase-03-videos/` (usar `docs/phases/phase-02-auth/` como referência de formato).

- [ ] **`/plan-context 03`** (skill `plan-context`) → gera `docs/phases/phase-03-videos/context.md`, consolidando `docs/project-plan.md`, o documento de decisões da Etapa 1, fases anteriores e o testing guide.
- [ ] **`/plan-validate 03`** (skill `plan-validate`) → gera `docs/phases/phase-03-videos/validation.md`, apontando inconsistências, decisões faltando e gaps de dependência.
- [ ] Iterar **`/plan-resolve 03`** (skill `plan-resolve`) ↔ `/plan-validate 03` até o `validation.md` fechar com `status: clean`:
  - [ ] `/plan-resolve 03` resolve as pendências apontadas, atualiza decisões/`context.md` e gera `docs/phases/phase-03-videos/library-refs.md` com as libs novas confirmadas via context7 (esperado nesta fase: cliente S3/MinIO, lib de fila, lib de processamento de vídeo/FFmpeg wrapper, etc.).
  - [ ] Revisar criticamente cada saída antes de re-rodar a validação.
- [ ] **`/plan-build 03`** (skill `plan-build`) → gera `docs/phases/phase-03-videos/phase-03-videos.md` com:
  - [ ] Step Implementations `SI-03.1`, `SI-03.2`, … (fatiados em passos pequenos e testáveis)
  - [ ] Technical Specifications: Data Model, API Contracts, Authorization Matrix, Error Catalog, **Events/Messages** (por causa da fila)
  - [ ] Dependency Map
  - [ ] Deliverables
- [ ] (Opcional) **`/plan-test-specs 03`** (skill `plan-test-specs`) → specs de teste, se o build emitir placeholders de spec.
- [ ] Revisar o plano final linha a linha: SIs bem fatiados, contratos e eventos claramente definidos, sem lacunas.

Checklist de saída da etapa:

- [ ] `docs/phases/phase-03-videos/context.md` presente.
- [ ] `docs/phases/phase-03-videos/validation.md` presente com `status: clean`.
- [ ] `docs/phases/phase-03-videos/library-refs.md` presente (libs novas fixadas via context7).
- [ ] `docs/phases/phase-03-videos/phase-03-videos.md` presente, com SIs + Technical Specs + Dependency Map + Deliverables.

---

## Etapa 3 — Implementação (SI a SI)

Comando: **`/implement 03`** (skill `implement`), conduzido pelo plano gerado na Etapa 2. Cada SI só é considerado concluído quando o código existe **e** a suíte de teste do SI passa.

### 3.1 Infraestrutura nova no `compose.yaml`

- [ ] Serviço de object storage (MinIO, compatível S3), com bucket(s) para vídeos e thumbnails conforme decidido no research.
- [ ] Serviço de fila (tecnologia decidida na Etapa 1), subindo junto com a stack via Docker Compose.
- [ ] Serviço/worker de vídeo (FFmpeg/ffprobe) consumindo a fila, como container separado.
- [ ] Todas as novas conexões entre serviços usando o nome do serviço do Compose como host (nunca `localhost`), conforme `CLAUDE.md`.

### 3.2 Persistência

- [ ] Migration `<timestamp>-CreateVideos.ts` em `nestjs-project/src/database/migrations/`, criando a tabela de vídeos ligada ao canal.
- [ ] Entidade de vídeo com, no mínimo: identificação, dono (canal), título, status (rascunho → processando → pronto/erro), chave de storage do arquivo, chave de storage do thumbnail, duração, metadados e identificador da URL única — conforme o Data Model definido no plano.

### 3.3 Módulo de vídeos no backend

- [ ] Novo módulo `nestjs-project/src/videos/` (estrutura de arquivos definida pelo plano; usar `auth/` como referência de forma: separação de camadas, repository pattern).
- [ ] Endpoint(s) de início de upload — pré-cadastro automático do vídeo como rascunho, geração da URL pré-assinada/multipart para upload direto ao storage.
- [ ] Integração com a fila — publicação do evento/job de processamento ao concluir o upload.
- [ ] Worker consumindo o job: extração de duração/metadados (ffprobe) e geração de thumbnail (FFmpeg), atualizando o status do vídeo no banco.
- [ ] Endpoint de geração/consulta da URL única por vídeo, sem conflito.
- [ ] Endpoint de streaming com suporte a `Range` / `206 Partial Content`.
- [ ] Endpoint de download do vídeo.
- [ ] Tratamento de falha no processamento, refletindo status de erro no banco.
- [ ] Reaproveitar padrões já existentes no projeto: guard JWT global, filtro de exceções de domínio, `ValidationPipe` global, rate limiting.

### 3.4 Testes (por SI, seguindo `testing-guide-nestjs-project`)

- [ ] Unit (`*.spec.ts`) para lógica de serviço/regras de negócio.
- [ ] Integração (`*.integration-spec.ts`) contra banco/storage/fila reais do Compose — sem mockar o que dá para testar de verdade.
- [ ] E2E (`*.e2e-spec.ts`, via supertest) cobrindo os fluxos ponta a ponta: upload → processamento → streaming/download.
- [ ] Rodar a suíte do SI a cada passo; só avançar para o próximo SI com testes verdes.

### 3.5 Progresso

- [ ] Atualizar `docs/phases/phase-03-videos/progress.md` a cada SI concluído (status + testes), como feito na Fase 02.

---

## Etapa 4 — Fechamento

- [ ] Definition of Done completa (`CLAUDE.md`):
  - [ ] Suíte relevante do SI passa a cada passo.
  - [ ] Suíte completa passa: `npm test`, `npm run test:integration`, `npm run test:e2e`.
  - [ ] `npx tsc --noEmit` sai com código 0.
  - [ ] `npm run lint` passa.
- [ ] Atualizar `nestjs-project/CLAUDE.md` (e/ou `CLAUDE.md` raiz) com a seção de vídeos: módulo, endpoints, fila/worker e storage — refletindo o estado real do código, sem citar arquivos ou comportamentos inexistentes.
- [ ] Revisar os Critérios de Aceite do `ENUNCIADO.md` item a item:
  - [ ] Decisões e planejamento (documento de decisões, pasta da fase completa, formato do plano).
  - [ ] Implementação — feature (upload 10GB sem travar, processamento automático, URL única, streaming + download, ciclo de status).
  - [ ] Implementação — infraestrutura e qualidade (storage/fila/worker no Compose, migration, testes verdes, DoD completa, Git Flow respeitado).
  - [ ] Documentação e ferramenta (`CLAUDE.md` coerente com o código; fundação de IA portada se usou outra ferramenta).
- [ ] Confirmar que nenhum item da lista de "Reprova automática" do enunciado se aplica.
- [ ] Abrir PR de `feature/phase-03-videos` para `dev` (sem commit direto na `main`).

---

## Referência rápida de comandos (Claude Code)

```
/research                     # Etapa 1 — decisões técnicas
/plan-context 03               # Etapa 2 — context.md
/plan-validate 03               # Etapa 2 — validation.md
/plan-resolve 03                 # Etapa 2 — resolve pendências + library-refs.md
/plan-build 03                    # Etapa 2 — phase-03-videos.md
/plan-test-specs 03                # Etapa 2 (opcional) — specs de teste
/implement 03                       # Etapa 3 — implementação SI a SI
```
