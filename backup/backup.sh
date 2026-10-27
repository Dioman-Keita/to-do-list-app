#!/bin/sh
# Sauvegarde du journal : base Postgres (format custom) + archive des images.
#   sh backup.sh once   -> une sauvegarde puis sortie
#   sh backup.sh loop   -> une sauvegarde toutes les BACKUP_INTERVAL_HOURS heures
set -eu

DEST=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
LOCK="$DEST/.backup.lock"

log() { echo "[$(date '+%F %T')] $*"; }

# Chaque commande est vérifiée explicitement : `set -e` est ignoré dans une
# fonction appelée avec `||`, on ne peut donc pas compter dessus ici.
backup_once() {
  mkdir -p "$DEST" || return 1
  # Une seule sauvegarde à la fois (boucle automatique + lancement manuel).
  if ! mkdir "$LOCK" 2>/dev/null; then
    log "Une sauvegarde est déjà en cours, abandon."
    return 1
  fi
  trap 'rm -rf "$LOCK"' EXIT

  ts=$(date +%Y-%m-%d_%H%M%S)
  tmp_db="$DEST/.db_$ts.$$.part"
  tmp_up="$DEST/.uploads_$ts.$$.part"

  if ! pg_dump --format=custom --file="$tmp_db"; then
    rm -f "$tmp_db"; rm -rf "$LOCK"
    log "ÉCHEC pg_dump"; return 1
  fi
  if ! tar -czf "$tmp_up" -C /data uploads; then
    rm -f "$tmp_db" "$tmp_up"; rm -rf "$LOCK"
    log "ÉCHEC archive des images"; return 1
  fi
  # Les deux fichiers ne sont publiés qu'une fois tous deux complets.
  if ! { mv "$tmp_up" "$DEST/uploads_$ts.tar.gz" && mv "$tmp_db" "$DEST/db_$ts.dump"; }; then
    rm -f "$tmp_db" "$tmp_up"; rm -rf "$LOCK"
    log "ÉCHEC publication des fichiers"; return 1
  fi

  # Rotation seulement après une sauvegarde réussie.
  find "$DEST" -maxdepth 1 \( -name 'db_*.dump' -o -name 'uploads_*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
  rm -rf "$LOCK"
  log "Sauvegarde $ts OK ($(du -sh "$DEST" | cut -f1) au total)"
}

case "${1:-once}" in
  loop)
    # Au démarrage du conteneur aucune sauvegarde ne tourne : un verrou restant
    # vient d'un arrêt brutal et bloquerait toutes les suivantes.
    rm -rf "$LOCK"
    while true; do
      backup_once || log "ÉCHEC de la sauvegarde" >&2
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
