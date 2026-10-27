#!/bin/sh
# Sauvegarde du journal : base Postgres (format custom) + archive des images.
#   sh backup.sh once   -> une sauvegarde puis sortie
#   sh backup.sh loop   -> une sauvegarde toutes les BACKUP_INTERVAL_HOURS heures
set -eu

DEST=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"

backup_once() {
  ts=$(date +%Y-%m-%d_%H%M)
  mkdir -p "$DEST"

  pg_dump --format=custom --file="$DEST/db_$ts.dump.part"
  mv "$DEST/db_$ts.dump.part" "$DEST/db_$ts.dump"

  tar -czf "$DEST/uploads_$ts.tar.gz.part" -C /data uploads
  mv "$DEST/uploads_$ts.tar.gz.part" "$DEST/uploads_$ts.tar.gz"

  find "$DEST" -maxdepth 1 \( -name 'db_*.dump' -o -name 'uploads_*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
  rm -f "$DEST"/*.part
  echo "[$(date '+%F %T')] Sauvegarde $ts OK ($(du -sh "$DEST" | cut -f1) au total)"
}

case "${1:-once}" in
  loop)
    while true; do
      backup_once || echo "[$(date '+%F %T')] ÉCHEC de la sauvegarde" >&2
      sleep "$((INTERVAL_HOURS * 3600))"
    done
    ;;
  once)
    backup_once
    ;;
  *)
    echo "usage: backup.sh [once|loop]" >&2
    exit 1
    ;;
esac
