#!/bin/sh
# Restaura um backup em um banco VAZIO (teste de restauração mensal — REQ-29).
#
# Uso (dentro do container de backup):
#   restore.sh /backups/fichaclin-AAAAMMDDTHHMMSSZ.dump.age  banco_destino  [/caminho/chave-privada.txt]
#
# A chave privada age é trazida só no momento do teste e apagada depois; nunca fica no servidor.
set -eu

FILE="$1"
TARGET_DB="$2"
KEY="${3:-}"

if [ "$TARGET_DB" = "${PGDATABASE:-fichaclin}" ]; then
  echo "Recusado: restaure em um banco separado (ex.: fichaclin_restore_teste), nunca por cima do banco em uso."
  exit 1
fi

createdb "$TARGET_DB"
case "$FILE" in
  *.age)
    [ -n "$KEY" ] || { echo "Informe a chave privada age para descriptografar."; exit 1; }
    age --decrypt --identity "$KEY" "$FILE" | pg_restore --no-owner --dbname="$TARGET_DB"
    ;;
  *)
    pg_restore --no-owner --dbname="$TARGET_DB" "$FILE"
    ;;
esac

echo "Restaurado em $TARGET_DB. Conferência rápida:"
psql --dbname="$TARGET_DB" -c "SELECT (SELECT count(*) FROM clinics) AS consultorios, (SELECT count(*) FROM patients) AS pacientes, (SELECT count(*) FROM clinical_entries) AS registros_clinicos;"
