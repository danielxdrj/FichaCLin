#!/bin/sh
# Backup do banco do Fichaclin (REQ-29): dump diário, criptografado, guardado fora da VPS.
#
# Variáveis:
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE   conexão (papel dono)
#   AGE_RECIPIENT                 chave PÚBLICA age (age1...). A chave privada NUNCA fica no servidor.
#   BACKUP_ALLOW_PLAINTEXT=1      só para ambiente local com dados fictícios
#   RCLONE_REMOTE                 destino fora da VPS, ex.: "backup:fichaclin-backups" (rclone)
#   BACKUP_INTERVAL_SECONDS       padrão 86400 (1 dia)
#   BACKUP_KEEP_DAYS              cópias locais mantidas (padrão 7)
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
DIR=/backups
mkdir -p "$DIR"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

if [ -z "${AGE_RECIPIENT:-}" ] && [ "${BACKUP_ALLOW_PLAINTEXT:-0}" != "1" ]; then
  log "ERRO: defina AGE_RECIPIENT (chave pública age). Backup sem criptografia não é permitido."
  sleep 300
  exit 1
fi

run_once() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  tmp="$DIR/.fichaclin-$ts.dump.partial"
  pg_dump --format=custom --no-owner --file="$tmp"

  if [ -n "${AGE_RECIPIENT:-}" ]; then
    out="$DIR/fichaclin-$ts.dump.age"
    age --recipient "$AGE_RECIPIENT" --output "$out" "$tmp"
    rm -f "$tmp"
  else
    out="$DIR/fichaclin-$ts.dump"
    mv "$tmp" "$out"
    log "AVISO: backup SEM criptografia (BACKUP_ALLOW_PLAINTEXT=1). Use só com dados fictícios."
  fi
  log "gerado $(basename "$out") ($(du -h "$out" | cut -f1))"

  if [ -n "${RCLONE_REMOTE:-}" ]; then
    rclone copy "$out" "$RCLONE_REMOTE" --quiet
    log "enviado para $RCLONE_REMOTE"
  else
    log "AVISO: RCLONE_REMOTE não definido — o backup ficou só nesta máquina (REQ-29 pede cópia fora da VPS)."
  fi

  find "$DIR" -name 'fichaclin-*' -type f -mtime +"$KEEP_DAYS" -delete
}

if [ "${1:-}" = "--once" ]; then
  run_once
  exit 0
fi

while true; do
  run_once || log "ERRO: backup falhou"
  sleep "$INTERVAL"
done
