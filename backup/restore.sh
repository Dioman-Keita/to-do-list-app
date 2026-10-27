#!/bin/sh
# Restaure une sauvegarde. ÉCRASE les données actuelles.
#   docker compose stop app
#   docker compose run --rm --entrypoint sh backup /scripts/restore.sh 2026-10-27_0300
#   docker compose start app
set -eu

ts="${1:-}"
if [ -z "$ts" ]; then
  echo "Sauvegardes disponibles :"
  ls -1 /backups | sed -n 's/^db_\(.*\)\.dump$/  \1/p'
  echo "usage: restore.sh <horodatage>" >&2
  exit 1
fi

db="/backups/db_$ts.dump"
files="/backups/uploads_$ts.tar.gz"
[ -f "$db" ] || { echo "Introuvable : $db" >&2; exit 1; }

echo "Restauration de la base depuis $db…"
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$db"

if [ -f "$files" ]; then
  echo "Restauration des images depuis $files…"
  rm -rf /data/uploads/*
  tar -xzf "$files" -C /data
fi
echo "Restauration terminée."
