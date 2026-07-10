#!/usr/bin/env bash
#
# Simula o upload real de um vídeo com mais de 10GB via curl, replicando o
# fluxo documentado em api.http (seção "VIDEOS — UPLOAD GRANDE"), mas de
# ponta a ponta e sem intervenção manual.
#
# Requisitos:
#   - API rodando: docker compose exec -d nestjs-api npm run start:dev
#   - Worker rodando (opcional, só se quiser ver o vídeo sair de
#     "processing"): docker compose exec -d video-worker npm run start:worker:dev
#   - Entrada no /etc/hosts apontando o hostname interno do MinIO para o
#     host (as URLs pré-assinadas usam "minio", que só existe na rede do
#     Compose):
#       sudo sh -c 'echo "127.0.0.1 minio" >> /etc/hosts'
#   - jq instalado (brew install jq)
#   - ~1.5GB livres em disco (os arquivos de parte são esparsos — apesar
#     de "aparentarem" 10GB, ocupam poucos MB reais até serem enviados)
#
# Uso:
#   ./test-large-upload.sh
#
# Sobrescrever host/credenciais via env vars:
#   BASE_URL=http://localhost:3000 EMAIL=me@example.com ./test-large-upload.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
MAILPIT_URL="${MAILPIT_URL:-http://localhost:8025}"
EMAIL="${EMAIL:-large-upload-$(date +%s)@example.com}"
PASSWORD="${PASSWORD:-password123}"
FIXTURES_DIR="src/test/fixtures/large-upload"

FIVE_GB_MINUS_1=5368709119   # 5GiB - 1, usado como `seek` do dd
ONE_MB_MINUS_1=1048575       # 1MiB - 1
DECLARED_SIZE_BYTES=10737418240  # exatamente 10GiB — limite permitido

log() { echo -e "\n\033[1;34m==> $*\033[0m"; }

command -v jq >/dev/null || { echo "jq não encontrado. Instale com: brew install jq"; exit 1; }

log "Verificando se a API está no ar em $BASE_URL"
if ! curl -sf -o /dev/null --max-time 3 "$BASE_URL/"; then
  echo "API não respondeu. Suba com: docker compose exec -d nestjs-api npm run start:dev"
  exit 1
fi

log "Gerando arquivos de parte esparsos em $FIXTURES_DIR (se ainda não existirem)"
mkdir -p "$FIXTURES_DIR"
[ -f "$FIXTURES_DIR/part-1.bin" ] || dd if=/dev/zero of="$FIXTURES_DIR/part-1.bin" bs=1 count=1 seek=$FIVE_GB_MINUS_1 2>/dev/null
[ -f "$FIXTURES_DIR/part-2.bin" ] || dd if=/dev/zero of="$FIXTURES_DIR/part-2.bin" bs=1 count=1 seek=$FIVE_GB_MINUS_1 2>/dev/null
[ -f "$FIXTURES_DIR/part-3.bin" ] || dd if=/dev/zero of="$FIXTURES_DIR/part-3.bin" bs=1 count=1 seek=$ONE_MB_MINUS_1 2>/dev/null
ls -lh "$FIXTURES_DIR"

log "1. Registrando usuário: $EMAIL"
curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq .

log "2. Buscando token de confirmação no Mailpit"
sleep 1
MSG_ID=$(curl -s "$MAILPIT_URL/api/v1/messages" | jq -r '.messages[0].ID')
HTML=$(curl -s "$MAILPIT_URL/api/v1/message/$MSG_ID" | jq -r '.HTML')
CONFIRM_TOKEN=$(echo "$HTML" | grep -oE 'token=[a-f0-9]+' | head -1 | cut -d= -f2)
[ -n "$CONFIRM_TOKEN" ] || { echo "Não encontrei o token de confirmação no Mailpit."; exit 1; }

log "3. Confirmando e-mail"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$BASE_URL/auth/confirm-email?token=$CONFIRM_TOKEN"

log "4. Login"
TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.access_token')
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "Login falhou."; exit 1; }
echo "Token obtido (${#TOKEN} caracteres, não exibido)"

log "5a. [Checagem rápida] Declarar > 10GB deve retornar 400 FILE_TOO_LARGE"
curl -s -X POST "$BASE_URL/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Rejected - too large","content_type":"video/mp4","size_bytes":10737418241,"original_filename":"too-big.mp4"}' \
  -w "\nHTTP %{http_code}\n"

log "5b. Iniciando upload real — size_bytes declarado no limite (10GiB exatos)"
INIT=$(curl -s -X POST "$BASE_URL/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"title\":\"Large upload via curl\",\"content_type\":\"video/mp4\",\"size_bytes\":$DECLARED_SIZE_BYTES,\"original_filename\":\"huge-video.mp4\"}")
echo "$INIT" | jq .
VIDEO_ID=$(echo "$INIT" | jq -r '.id')

log "6. Solicitando URLs pré-assinadas para as 3 partes"
PARTS=$(curl -s -X POST "$BASE_URL/videos/$VIDEO_ID/upload-parts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"part_numbers":[1,2,3]}')
URL1=$(echo "$PARTS" | jq -r '.parts[0].url')
URL2=$(echo "$PARTS" | jq -r '.parts[1].url')
URL3=$(echo "$PARTS" | jq -r '.parts[2].url')
echo "URLs obtidas (omitidas — contêm assinatura temporária)"

log "7. Enviando parte 1 (5GiB reais) — pode levar dezenas de segundos"
H1=$(curl -s -D - -o /dev/null --upload-file "$FIXTURES_DIR/part-1.bin" "$URL1")
echo "$H1" | grep -iE "^(HTTP|ETag)"
# O header ETag já vem entre aspas (ex.: "abc123...") — NÃO envolver em
# aspas de novo ao montar o JSON do /complete (isso quebra o parser).
ETAG1=$(echo "$H1" | grep -i "^etag:" | sed 's/^[Ee][Tt][Aa][Gg]: *//' | tr -d '\r')

log "8. Enviando parte 2 (5GiB reais) — pode levar dezenas de segundos"
H2=$(curl -s -D - -o /dev/null --upload-file "$FIXTURES_DIR/part-2.bin" "$URL2")
echo "$H2" | grep -iE "^(HTTP|ETag)"
ETAG2=$(echo "$H2" | grep -i "^etag:" | sed 's/^[Ee][Tt][Aa][Gg]: *//' | tr -d '\r')

log "9. Enviando parte 3 (1MiB — empurra o total para além de 10GB)"
H3=$(curl -s -D - -o /dev/null --upload-file "$FIXTURES_DIR/part-3.bin" "$URL3")
echo "$H3" | grep -iE "^(HTTP|ETag)"
ETAG3=$(echo "$H3" | grep -i "^etag:" | sed 's/^[Ee][Tt][Aa][Gg]: *//' | tr -d '\r')

log "10. Concluindo o upload"
BODY=$(jq -n --arg e1 "$ETAG1" --arg e2 "$ETAG2" --arg e3 "$ETAG3" \
  '{parts:[{part_number:1,etag:($e1|gsub("\"";""))},{part_number:2,etag:($e2|gsub("\"";""))},{part_number:3,etag:($e3|gsub("\"";""))}]}')
curl -s -X POST "$BASE_URL/videos/$VIDEO_ID/complete" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$BODY" \
  -w "\nHTTP %{http_code}\n" | tee /dev/stderr | jq . 2>/dev/null || true

log "11. Status do vídeo (draft → processing → ready/error, se o worker estiver rodando)"
curl -s "$BASE_URL/videos/$VIDEO_ID" -H "Authorization: Bearer $TOKEN" | jq .

log "Concluído. Video ID: $VIDEO_ID"
