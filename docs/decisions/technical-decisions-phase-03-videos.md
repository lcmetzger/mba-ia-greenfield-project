---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-08
scope_description: "Fila de processamento, estratégia de upload de 10GB, organização do object storage, worker de vídeo (metadados + thumbnail), URL única, streaming/download e ciclo de status do vídeo."
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — recebe o novo módulo de vídeos, o worker de processamento (segundo bootstrap no mesmo codebase) e a infraestrutura nova de storage/fila no `compose.yaml`. Todas as TDs deste documento se aplicam a este subprojeto.
- `next-frontend/` — fora do escopo desta fase por definição do próprio enunciado ("Há um frontend no repositório, mas a interface de vídeo não faz parte do escopo desta fase"). Nenhuma TD neste documento.

> Nota de processo: o MCP do context7 não está conectado nesta sessão (`.mcp.json` só configura o servidor `postgres`). A pesquisa de bibliotecas abaixo (BullMQ/`@nestjs/bullmq`, AWS SDK v3 multipart presigned) foi feita via busca web em fontes primárias (docs oficiais do BullMQ, NestJS, e repositórios de referência) em vez de context7. Recomenda-se confirmar as versões exatas via context7 na etapa `/plan-resolve`, quando as libs forem fixadas em `library-refs.md`.

---

## TD-01: Tecnologia de fila de processamento em segundo plano

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O `docs/project-plan.md` deixa esta escolha explicitamente em aberto ("Message Queue — TBD" no diagrama de arquitetura). É a decisão de stack mais significativa da fase: o worker de vídeo depende dela para receber jobs de processamento (extração de metadados + thumbnail) de forma assíncrona, com necessidade real de retry/backoff, já que `ffmpeg`/`ffprobe` podem falhar (arquivo corrompido, codec não suportado, timeout).

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Fila baseada em Redis, com wrapper oficial mantido pela organização NestJS (`@nestjs/bullmq`), expondo `BullModule.forRootAsync`/`registerQueue` para o producer e `@Processor`/`WorkerHost`/`@OnWorkerEvent` para o consumer.
- **Pros:** integração NestJS de primeira classe (mesmo padrão de DI/config do resto do projeto); retry com backoff exponencial e limite de tentativas nativos por job (`attempts`, `backoff`); fila "failed" nativa funciona como DLQ sem infraestrutura extra; Redis é um único container leve e bem conhecido.
- **Cons:** introduz Redis como nova peça de infraestrutura (ainda que leve); fila em memória/disco do Redis não tem as garantias transacionais de um banco relacional (não é um problema aqui, pois os jobs são idempotentes/reprocessáveis).

### Option B: RabbitMQ (`@golevelup/nestjs-rabbitmq`, sem wrapper oficial)
- Broker de mensageria com exchanges/filas/bindings, integrado à NestJS via uma lib comunitária (não mantida pela organização NestJS).
- **Pros:** modelo de roteamento mais rico (exchanges, routing keys, fanout) e maduro para arquiteturas de múltiplos consumidores/tipos de evento.
- **Cons:** poder de roteamento não utilizado neste escopo (há apenas um tipo de job: "processar vídeo"); sem wrapper oficial da NestJS; configurar DLQ exige exchange/fila dedicadas (mais peças manuais que a fila "failed" nativa do BullMQ); mais uma peça de infraestrutura pesada para o curso.

### Option C: pg-boss (fila sobre PostgreSQL, via polling)
- Biblioteca de fila que usa o próprio Postgres como armazenamento e mecanismo de coordenação (sem broker dedicado).
- **Pros:** nenhum container novo — reaproveita o Postgres já existente no Compose.
- **Cons:** acopla a carga de processamento (polling) ao mesmo banco transacional do domínio (users/channels/videos); sem wrapper oficial NestJS; ecossistema de observabilidade/retry mais fraco que BullMQ; polling é menos responsivo que pub/sub baseado em Redis.

**Recommendation:** **A (BullMQ + Redis)** — o caso de uso é um único tipo de job com necessidade real de retry/backoff/DLQ, exatamente o ponto forte do BullMQ, com integração oficial NestJS. RabbitMQ traria poder de roteamento não utilizado neste escopo; pg-boss evitaria um container novo, mas acoplaria a carga de processamento ao Postgres transacional do domínio e tem integração/observabilidade mais fraca — não compensa a economia de um container Redis, que é trivial de operar em Compose.

**Decision:** A (BullMQ + Redis)
**Libraries:** @nestjs/bullmq, bullmq, ioredis

---

## TD-02: Organização de buckets e chaves no object storage

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O object storage em si não é uma escolha em aberto — o projeto já aponta para S3 (compatível), operado localmente como MinIO em Docker. O que precisa ser decidido é **como usá-lo**: quantos buckets, política de acesso por bucket, e o formato das chaves de objeto para o vídeo original e para o thumbnail gerado pelo worker.

**Options:**

### Option A: Dois buckets separados por política de acesso, chave por UUID do vídeo
- `streamtube-videos` (privado, nunca público) e `streamtube-thumbnails` (pode virar público em fase futura, quando o frontend carregar thumbnails direto do storage). Chave do vídeo: `videos/{videoId}/original` (sem extensão — `Content-Type` e `original_filename` ficam na entidade). Chave do thumbnail: `thumbnails/{videoId}/thumbnail.jpg`.
- **Pros:** isolamento de política de acesso por bucket desde o início (evita ter que gerenciar policy por prefixo dentro de um único bucket quando a Fase 04+ tornar thumbnails públicas); chave derivada do `Video.id` garante unicidade sem coordenação adicional.
- **Cons:** dois buckets para criar/gerenciar no bootstrap do MinIO (mitigado por um serviço `minio-init` no Compose que roda `mc mb` uma vez).

### Option B: Um único bucket com prefixos (`videos/` e `thumbnails/`)
- Um bucket (`streamtube-media`) com os mesmos padrões de chave por prefixo.
- **Pros:** menos objetos de infraestrutura para provisionar (um bucket só).
- **Cons:** política de acesso por prefixo dentro do mesmo bucket é mais frágil de configurar corretamente (bucket policies do S3/MinIO operam bem com wildcards de prefixo, mas misturar conteúdo que deve ser sempre privado com conteúdo que pode virar público no mesmo bucket aumenta o risco de uma policy mal configurada expor vídeos originais).

### Option C: Chave derivada de hash de conteúdo (content-addressable) em vez do UUID do vídeo
- Chave = hash SHA-256 do arquivo, permitindo deduplicação de uploads idênticos.
- **Pros:** evita armazenar o mesmo arquivo duas vezes se dois usuários enviarem o vídeo idêntico.
- **Cons:** exige calcular o hash do arquivo inteiro antes de saber a chave final — incompatível com o fluxo de multipart upload direto ao storage (a API nunca vê o conteúdo do arquivo); deduplicação entre canais diferentes não é um requisito do enunciado; adiciona complexidade sem benefício claro nesta fase.

**Recommendation:** **A (dois buckets, chave por UUID do vídeo)** — separa a política de acesso desde já (vídeo original nunca público; thumbnail plausivelmente público em fase futura), evitando reconfigurar policies depois, e a chave derivada do `Video.id` (já um UUID gerado pela entidade) não exige nenhum mecanismo novo de geração de identificador.

**Decision:** A (dois buckets, chave por UUID do vídeo)
**Libraries:** —

---

## TD-03: Estratégia de upload de vídeos de até 10GB sem travar a API

**Scope:** Backend

**Capability:** Transversal — covers: Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** O `docs/project-plan.md` (seção "Pontos de Atenção") exige explicitamente que o upload de até 10GB "não trave o sistema" e "permita retomar em caso de falha de conexão". Isso descarta qualquer estratégia que faça o corpo do arquivo passar pelo processo Node da API (mesmo em streaming, o processo fica ocupado por toda a duração do upload de um arquivo de 10GB, competindo por recursos com outras requisições).

**Options:**

### Option A: Multipart upload direto ao storage via URLs pré-assinadas (S3/MinIO)
- Fluxo: `POST /videos` cria o vídeo como rascunho e inicia um `CreateMultipartUpload` no MinIO, devolvendo `videoId` + `uploadId`. `POST /videos/:id/upload-parts` devolve URLs pré-assinadas de `PUT` por número de parte (chamável novamente para repetir uma parte que falhou, sem reiniciar o upload inteiro). O cliente faz o `PUT` de cada parte **direto ao MinIO**, sem passar pela API. `POST /videos/:id/complete` finaliza o multipart (`CompleteMultipartUpload` com a lista de ETags), valida o objeto e dispara o processamento.
- **Pros:** o corpo do arquivo nunca passa pelo processo Node — a API só troca metadados pequenos (URLs, ETags); resumível de forma nativa (uma parte que falhar pode ser reenviada isoladamente, sem refazer as partes já confirmadas), atendendo diretamente ao requisito de "permitir retomar em caso de falha de conexão"; é o padrão de mercado (S3-compatible) e a base do `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
- **Cons:** exige orquestrar 3 chamadas HTTP (start/parts/complete) em vez de uma só; a API depende do cliente (ou de um passo posterior) chamar `/complete` para saber que o upload terminou — não há como o storage "avisar sozinho" sem configurar webhook adicional no MinIO.

### Option B: Streaming através da API com backpressure (sem bufferizar em memória)
- A API recebe o `multipart/form-data` via um parser com streaming (ex. `busboy`) e repassa os bytes, chunk a chunk, direto para um `PutObject` (ou upload multipart) no storage, sem nunca materializar o arquivo inteiro em memória ou disco.
- **Pros:** um único endpoint HTTP, sem orquestração de múltiplas chamadas.
- **Cons:** o processo Node fica ocupado (uma conexão HTTP aberta) durante toda a duração do upload de até 10GB — sob múltiplos uploads simultâneos, isso consome conexões/handles do processo da API mesmo sem bufferizar payload, o que é exatamente o tipo de acoplamento que o requisito "não travar o sistema" pede para evitar; retomada em caso de queda de conexão exige reimplementar range requests manualmente (o protocolo HTTP simples não tem isso nativo).

### Option C: Protocolo tus (resumable upload protocol) com servidor tus dedicado
- Um servidor tus (ex. `tusd`) recebe uploads resumíveis em chunks via um protocolo padronizado (cabeçalhos `Upload-Offset`, `Upload-Length` etc.), com hooks para notificar a API quando o upload terminar.
- **Pros:** resumabilidade é o objetivo central do protocolo, com clientes/bibliotecas maduras (`tus-js-client`) já preparadas para retomar uploads após queda de conexão.
- **Cons:** introduz um componente de infraestrutura inteiramente novo (servidor tus) só para o upload, redundante com a capacidade de multipart upload que o próprio MinIO/S3 já oferece nativamente; mais uma peça para subir/testar via Compose sem ganho sobre a Option A, que já resolve resumabilidade usando a infraestrutura de storage que o projeto já vai ter de qualquer forma.

**Recommendation:** **A (multipart upload direto ao storage via URLs pré-assinadas)** — é a única opção que garante que o corpo do arquivo nunca passa pelo processo da API (Option B mantém uma conexão HTTP ocupada por até 10GB, o que ainda é o tipo de acoplamento que o requisito quer evitar) e resolve retomada de upload nativamente via reenvio de partes individuais, sem introduzir um componente de infraestrutura redundante (Option C).

**Decision:** A (multipart upload direto ao storage via URLs pré-assinadas)
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

---

## TD-04: Execução do worker e extração de metadados/thumbnail

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O processamento (extração de metadados via `ffprobe` e geração de thumbnail via `ffmpeg`) é pesado e deve rodar fora do processo da API, consumindo jobs da fila decidida em TD-01. É preciso decidir onde e como esse worker roda, e como ele invoca `ffmpeg`/`ffprobe`.

**Options:**

### Option A: Segundo bootstrap NestJS no mesmo codebase, container Docker próprio
- Um `src/worker.main.ts` (`NestFactory.createApplicationContext(WorkerModule)`, sem HTTP/guards) reaproveita as entidades TypeORM, config e exceções de domínio já existentes. Roda como um segundo serviço no `compose.yaml` (`video-worker`), construído a partir da mesma imagem/Dockerfile da API (com `ffmpeg` adicionado via `apt`), consumindo a fila via `@Processor`. `ffmpeg`/`ffprobe` são invocados via `child_process.execFile` (binários de sistema, não pacotes npm).
- **Pros:** reaproveita 100% das convenções já estabelecidas no projeto (entidades, config namespaced, exceções de domínio, padrão de módulo); nenhuma nova linguagem/stack para manter; consistente com o padrão de "processo Node ocioso, comandos via `docker compose exec`" já usado pela API.
- **Cons:** acopla o worker ao mesmo `package.json`/`node_modules` da API (não é um problema real aqui, já que ambos compartilham o mesmo repositório e dependências).

### Option B: Script Node standalone fora do Nest (sem DI), mesmo container
- Um script Node puro (sem `NestFactory`, sem módulos) conectado diretamente ao Postgres/fila via clients crus.
- **Pros:** menos overhead de bootstrap do framework.
- **Cons:** perde acesso direto às entidades TypeORM, config validado via Joi e exceções de domínio já existentes — precisaria duplicar esse código ou importar módulos do Nest de forma não convencional; abandona o padrão arquitetural do resto do projeto sem ganho real.

### Option C: Serviço separado em outra stack/linguagem (ex. Python + moviepy)
- Um microsserviço independente, em outra linguagem mais comum para processamento de mídia, comunicando via fila.
- **Pros:** acesso a bibliotecas de processamento de vídeo mais especializadas em algumas linguagens.
- **Cons:** introduz uma segunda linguagem/runtime no repositório só para esta fase, sem necessidade — `ffmpeg`/`ffprobe` são binários de sistema chamáveis de qualquer linguagem via `child_process`/`subprocess`, então o ganho de trocar de stack é nulo aqui; aumenta a superfície de manutenção (dois ecossistemas de dependências, dois pipelines de build) para um curso cujo objetivo é o workflow de IA sobre um único stack já estabelecido.

**Recommendation:** **A (segundo bootstrap NestJS, mesmo codebase, container próprio)** — reaproveita integralmente os padrões e a infraestrutura de código já validados nas Fases 01/02 (entidades, config, exceções de domínio), evitando duplicar lógica ou introduzir uma segunda stack só para chamar dois comandos de sistema (`ffprobe`/`ffmpeg`) que qualquer linguagem invoca da mesma forma trivial via `child_process`.

**Decision:** A (segundo bootstrap NestJS, mesmo codebase, container próprio)
**Libraries:** —

---

## TD-05: URL única por vídeo e estratégia de streaming/download

**Scope:** Backend

**Capability:** Transversal — covers: URL única por vídeo, sem conflito com outros vídeos; Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** O `docs/project-plan.md` (seção "Pontos de Atenção") pede uma URL "curta e única" por vídeo. Streaming precisa suportar requisições `Range`/resposta `206 Partial Content` para não exigir download completo antes de reproduzir. Como ainda não existe conceito de vídeo público/unlisted (isso é Fase 04), qualquer vídeo hoje só deve ser acessível pelo dono do canal — o que constrange a forma de entrega dos bytes.

**Options:**

### Option A: Identificador = UUID da entidade (`Video.id`); API como proxy autenticado
- A URL pública é `/videos/{id}/stream` e `/videos/{id}/download`, onde `{id}` é o próprio UUID gerado pela entidade (mesmo padrão já usado em `User`/`Channel`). A API lê do storage via SDK e faz *pipe* (stream) da resposta ao cliente, respeitando `Range`/206, checando posse do vídeo a cada requisição.
- **Pros:** nenhum identificador novo para gerar/gerenciar — reaproveita a PK que a entidade já tem; unicidade garantida pelo próprio gerador de UUID, sem checagem de colisão.
- **Cons:** UUID (36 caracteres) não atende literalmente ao requisito de URL "curta" citado no `project-plan.md`.

### Option B: Identificador = código curto dedicado (ex. `nanoid`, 10-12 caracteres); API como proxy autenticado
- No pré-cadastro (`POST /videos`), além do `id` (UUID, chave primária interna), é gerado um `short_code` curto e único (biblioteca `nanoid`, alfabeto URL-safe) com constraint `UNIQUE` no banco. As rotas públicas usam esse `short_code` (`/videos/{shortCode}/stream`), e a API resolve internamente para o `Video.id`. Mesma estratégia de entrega por proxy/pipe com checagem de posse a cada requisição.
- **Pros:** atende literalmente ao requisito "URL curta e única" do `project-plan.md`; `nanoid` com 10-12 caracteres tem probabilidade de colisão desprezível na escala deste projeto, e a constraint `UNIQUE` garante a garantia dura de "nunca conflite com outro vídeo" independentemente da probabilidade estatística.
- **Cons:** introduz um segundo identificador e uma nova dependência (`nanoid`); exige uma coluna extra + índice único e (raríssimo, mas possível) lidar com colisão na geração.

### Option C: Identificador = UUID da entidade; entrega via redirect a URL pré-assinada de leitura do storage
- A API responde `302` com uma URL pré-assinada de leitura do MinIO/S3 (que expira em N minutos), em vez de fazer proxy dos bytes.
- **Pros:** menor carga na API (não faz proxy de bytes — apenas emite o redirect); implementação mais simples no lado da API.
- **Cons:** a URL pré-assinada expira e muda a cada emissão, then quebra a ideia de "URL única e estável" na perspectiva do cliente/cache; a checagem de posse só acontece no momento em que a API emite o redirect — uma vez emitida, a URL assinada funciona para qualquer um até expirar, enfraquecendo o controle de acesso justo na fase em que ainda não existe conceito de vídeo público.

**Recommendation:** **B (código curto dedicado + proxy autenticado)** — é a única combinação que atende ao requisito explícito de URL "curta" do `project-plan.md` sem abrir mão da checagem de posse a cada acesso (necessária enquanto não existe conceito de vídeo público/unlisted, que só chega na Fase 04). O custo adicional (uma dependência pequena e bem estabelecida, mais uma coluna com índice único) é baixo frente ao ganho de aderência ao requisito documentado.

**Decision:** B (código curto dedicado + proxy autenticado)
**Libraries:** @aws-sdk/client-s3, nanoid

---

## TD-06: Ciclo de status do vídeo e tratamento de falha no processamento

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** É preciso definir os estados possíveis de um vídeo, as transições válidas, e o que acontece quando o processamento falha (arquivo corrompido, `ffmpeg` retorna erro, timeout etc.) — incluindo se existe algum caminho de recuperação sem exigir reupload de um arquivo de até 10GB.

**Options:**

### Option A: Enum simples (`draft` → `processing` → `ready`/`error`), sem caminho de recuperação manual
- `draft` no pré-cadastro; `processing` ao completar o upload (TD-03) e enfileirar o job; `ready` quando o worker (TD-04) termina com sucesso; `error` (com `error_message`) somente depois de esgotar as tentativas de retry automático do BullMQ (`attempts` + backoff exponencial, TD-01). Sem endpoint para tentar de novo — um vídeo em erro fica definitivamente em erro.
- **Pros:** modelo mais simples de implementar e testar; menos superfície de API.
- **Cons:** um erro transitório já corrigido (ex. bug no worker ajustado depois) obriga o usuário a reenviar o arquivo inteiro (até 10GB) para tentar de novo, mesmo que o objeto original ainda esteja íntegro no storage.

### Option B: Mesmo enum + endpoint de reprocessamento manual (`POST /videos/:id/reprocess`)
- Mesmos 4 estados e mesmo retry automático da Option A, mas com um endpoint adicional que, quando `status = error`, reseta para `processing` e reenfileira o job de processamento **sem exigir novo upload** (o objeto original já está no storage).
- **Pros:** atende diretamente a "o que acontece em caso de falha no processamento" sem custo de reupload; reaproveita o mesmo pipeline do worker, sem lógica nova além de resetar o status e reenfileirar.
- **Cons:** mais um endpoint para especificar/testar (autorização — só o dono do canal; só a partir de `status = error`).

### Option C: Enum estendido com estado intermediário `uploading` (`draft` → `uploading` → `processing` → `ready`/`error`)
- Separa "rascunho pré-cadastrado, upload não iniciado" (`draft`) de "partes sendo enviadas" (`uploading`), transicionando para `uploading` na primeira chamada a `POST /videos/:id/upload-parts`.
- **Pros:** granularidade maior para eventualmente exibir progresso de upload na UI (fora do escopo desta fase).
- **Cons:** exige uma transição de estado adicional sem consumidor nesta fase (não há UI de vídeos ainda — Fase 04); mais um estado para cobrir nos testes sem benefício observável dentro do escopo atual.

**Recommendation:** **B (enum simples + reprocessamento manual)** — atende ao requisito explícito do enunciado ("o que acontece em caso de falha no processamento") sem o custo de reupload de um arquivo grande, com uma adição pequena e bem contida (um endpoint) sobre a Option A. A Option C adiciona granularidade sem consumidor nesta fase — melhor avaliar quando a Fase 04 trouxer UI de progresso de upload.

**Decision:** B (enum simples + reprocessamento manual)
**Libraries:** —

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Tecnologia de fila de processamento | A (BullMQ + Redis) | A (BullMQ + Redis) |
| TD-02 | Backend | Organização de buckets e chaves no object storage | A (dois buckets, chave por UUID) | A (dois buckets, chave por UUID) |
| TD-03 | Backend | Estratégia de upload de 10GB sem travar a API | A (multipart via URLs pré-assinadas) | A (multipart via URLs pré-assinadas) |
| TD-04 | Backend | Execução do worker e extração de metadados/thumbnail | A (segundo bootstrap NestJS, mesmo codebase) | A (segundo bootstrap NestJS, mesmo codebase) |
| TD-05 | Backend | URL única e estratégia de streaming/download | B (código curto + proxy autenticado) | B (código curto + proxy autenticado) |
| TD-06 | Backend | Ciclo de status do vídeo e tratamento de falha | B (enum simples + reprocessamento manual) | B (enum simples + reprocessamento manual) |
