---
libs:
  "@nestjs/bullmq":
    version: "^11.0.4"
    context7_id: "N/A — Context7 MCP não conectado nesta sessão; ver nota no corpo do arquivo"
    fetched_at: "2026-07-08T01:07:42+00:00"
  bullmq:
    version: "^5.79.3"
    context7_id: "N/A — Context7 MCP não conectado nesta sessão; ver nota no corpo do arquivo"
    fetched_at: "2026-07-08T01:07:42+00:00"
  ioredis:
    version: "^5.11.1"
    context7_id: "N/A — Context7 MCP não conectado nesta sessão; ver nota no corpo do arquivo"
    fetched_at: "2026-07-08T01:07:42+00:00"
  "@aws-sdk/client-s3":
    version: "^3.1081.0"
    context7_id: "N/A — Context7 MCP não conectado nesta sessão; ver nota no corpo do arquivo"
    fetched_at: "2026-07-08T01:07:42+00:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1081.0"
    context7_id: "N/A — Context7 MCP não conectado nesta sessão; ver nota no corpo do arquivo"
    fetched_at: "2026-07-08T01:07:42+00:00"
  nanoid:
    version: "^3.3.8"
    context7_id: "N/A — Context7 MCP não conectado nesta sessão; ver nota no corpo do arquivo"
    fetched_at: "2026-07-08T01:07:42+00:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-07T22:03:16-03:00"
---

> **Nota de processo:** o MCP do context7 não está conectado nesta sessão (`.mcp.json` só configura o servidor `postgres`). A documentação abaixo foi levantada via WebSearch/WebFetch contra fontes primárias (docs oficiais do BullMQ, NestJS, AWS SDK v3, npm registry) em vez de context7. Recomenda-se reconfirmar via context7 assim que o MCP estiver disponível no ambiente.

## @nestjs/bullmq

**Source:** `docs.bullmq.io/guide/nestjs`, `docs.nestjs.com/techniques/queues`, npm registry (versão confirmada: `11.0.4`, peerDependency `@nestjs/core: ^10.0.0 || ^11.0.0` — compatível com o NestJS 11 já instalado no projeto).

### Módulo (producer — `src/queue/queue.module.ts`)

```ts
BullModule.forRootAsync({
  inject: [queueConfig.KEY],
  useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
    connection: { host: cfg.redisHost, port: cfg.redisPort },
  }),
}),
BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
```

Producer (dentro de `VideosService`, ao completar o upload — TD-03/TD-06):

```ts
constructor(@InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly queue: Queue) {}

await this.queue.add(
  'process-video',
  { videoId },
  { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
);
```

### Consumer (worker — `src/video-processing/video-processing.processor.ts`)

```ts
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> {
    // download -> ffprobe -> ffmpeg thumbnail -> upload -> update DB (status=ready)
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error) {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      // último attempt esgotado — status=error (TD-06)
    }
  }
}
```

O `WorkerModule` (bootstrap separado, TD-04) importa `BullModule.forRootAsync` + `registerQueue` novamente — é seguro, módulos NestJS são singletons por grafo de imports, mesmo padrão já usado no projeto para módulos compartilhados.

### Testing notes (integração real, nunca mock)

Testes de integração devem rodar contra o Redis real do Compose (`redis` como hostname, nunca `localhost`), conforme a regra do projeto de não mockar libs configuradas/dependências de efeito colateral. Padrão sugerido pelo `testing-guide-nestjs-project` (`references/external-systems.md`): injetar `getQueueToken(VIDEO_PROCESSING_QUEUE)` no módulo de teste e asserir contra o `Queue` real (`queue.getJobs(['waiting'])`, `queue.getJob(id)`), em vez de mockar `Queue`/`Worker`.

---

## bullmq

**Source:** `docs.bullmq.io/guide/retrying-failing-jobs`, `docs.bullmq.io/changelog` (versão confirmada: `5.79.3`, changelog recente inclui `attemptsMade` atualizado no evento `failed`).

### Retry/backoff (TD-01, TD-06)

- `attempts: N` — número máximo de tentativas.
- `backoff: { type: 'exponential', delay: 5000 }` — cada retry espera `2^(attempt-1) * delay` ms.
- Jobs que esgotam as tentativas ficam retidos na fila "failed" nativamente — funciona como DLQ sem infraestrutura extra (`queue.getJobs(['failed'])` para inspeção manual).
- Distinguir falha transitória (ainda vai retentar) de falha definitiva: comparar `job.attemptsMade` com `job.opts.attempts` dentro do handler `@OnWorkerEvent('failed')` — só marcar `status=error` na entidade quando `attemptsMade >= opts.attempts`.
- Para erros não recuperáveis (ex.: arquivo corrompido, formato inválido — não adianta retentar), lançar `UnrecoverableError` do próprio `bullmq` dentro de `process()`: move o job direto para failed, ignorando `attempts` restantes.

### Testing notes

Mesma orientação da seção `@nestjs/bullmq` acima — testar contra Redis real, nunca mockar `Queue`/`Worker`.

---

## ioredis

**Source:** npm registry (versão confirmada: `5.11.1`) — cliente Redis usado internamente pela conexão do BullMQ.

### Shape de conexão esperado por `BullModule.forRootAsync`

```ts
connection: {
  host: process.env.REDIS_HOST ?? 'redis',   // nome do serviço Compose, nunca localhost
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
}
```

Não é necessário instanciar `ioredis` diretamente — o BullMQ já o usa como dependência interna ao receber o objeto `connection`. A lib entra como dependência direta apenas porque `@nestjs/bullmq`/`bullmq` a exigem como peer.

### Testing notes

Nenhum teste direto de `ioredis` é necessário — a cobertura vem via os testes de integração da fila (acima).

---

## @aws-sdk/client-s3

**Source:** `docs.aws.amazon.com/AmazonS3/latest/API/API_CreateMultipartUpload.html`, `docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-upload-object.html`, npm registry (versão confirmada: `3.1081.0`).

### Configuração do client para MinIO (TD-02/TD-03/TD-05)

```ts
new S3Client({
  region: 'us-east-1',           // valor fixo — MinIO ignora, mas o SDK exige um valor
  endpoint: `http://${cfg.storageHost}:${cfg.storagePort}`,  // ex. http://minio:9000
  forcePathStyle: true,          // obrigatório para MinIO (path-style, não virtual-hosted)
  credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
})
```

### Multipart upload (TD-03)

```ts
const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
  Bucket: 'streamtube-videos', Key: `videos/${videoId}/original`, ContentType: contentType,
}));

// por parte, gera URL presignada de PUT (via s3-request-presigner) para UploadPartCommand
// cliente envia o PUT direto ao MinIO com essa URL

await s3.send(new CompleteMultipartUploadCommand({
  Bucket: 'streamtube-videos', Key: `videos/${videoId}/original`, UploadId,
  MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) },
}));
```

`CreateMultipartUpload` inicia o upload e retorna o `UploadId` usado para associar todas as partes; partes podem ser enviadas independentemente e em qualquer ordem, e uma parte que falhar pode ser reenviada sem afetar as demais — é a base da resumabilidade decidida em TD-03.

### Streaming com Range (TD-05)

```ts
const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
const { Body, ContentRange, ContentLength } = await s3.send(new GetObjectCommand({
  Bucket, Key, Range: rangeHeader,   // ex. "bytes=0-1023", repassado do header Range da requisição
}));
// Body é um stream (Node.Readable no runtime Node) — pipe direto para a resposta HTTP,
// respondendo 206 com Content-Range/Content-Length/Accept-Ranges quando Range foi informado.
```

### Testing notes

Testes de integração devem rodar contra o MinIO real do Compose (`minio` como hostname), usando um helper `src/test/minio.ts` no mesmo padrão de `src/test/mailpit.ts` — nunca mockar `S3Client`.

---

## @aws-sdk/s3-request-presigner

**Source:** AWS SDK v3 docs, mesma versão major de `@aws-sdk/client-s3` (`3.1081.0`).

### Geração de URL presignada por parte (TD-03)

```ts
const url = await getSignedUrl(
  s3,
  new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }),
  { expiresIn: 3600 },
);
```

Reexecutável por parte — chamar de novo para a mesma `PartNumber` gera uma nova URL válida, permitindo retry de uma parte específica sem afetar as demais (base da resumabilidade da TD-03).

### Testing notes

Cobertos pelos mesmos testes de integração de `@aws-sdk/client-s3` — a integration-spec de upload deve exercitar o ciclo completo (gerar URL → PUT real na URL → complete) contra o MinIO real.

---

## nanoid

**Source:** `github.com/ai/nanoid` (README), npm registry.

**Atenção — versão pinada em `^3.3.8`, não a última (5.x):** a partir da v4, o `nanoid` é **ESM-only** (`Error [ERR_REQUIRE_ESM]` ao usar `require()`), o que quebra sob o `ts-jest`/Jest deste projeto (transform CommonJS). A v3.x é a última totalmente compatível com `require()`, evitando fricção de interop ESM/CJS nos testes — decisão consistente com a preferência já registrada em TD-02 da Fase 02 (menos dependências/complexidade quando o ganho é marginal).

### Geração do código curto (TD-05)

```ts
import { customAlphabet } from 'nanoid';

const generateShortCode = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  12,
);
```

12 caracteres em alfabeto alfanumérico (62 símbolos) dá ~71 bits de aleatoriedade — probabilidade de colisão desprezível na escala deste projeto (referência: Nano ID com 126 bits — UUID v4 tem 122 — precisa de ~103 trilhões de IDs gerados para 1 em um bilhão de chance de colisão; 12 caracteres em base62 está na mesma ordem de grandeza de segurança prática). A constraint `UNIQUE` no banco (`Video.short_code`) permanece como garantia dura, independente da probabilidade estatística.

### Testing notes

Teste unitário puro (sem I/O) para a função de geração de chave, seguindo o padrão já usado em `src/channels/nickname.util.spec.ts` (util puro colocado ao lado do módulo).
