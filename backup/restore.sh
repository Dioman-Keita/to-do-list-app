#!/bin/sh
# Restaure une sauvegarde. ÉCRASE les données actuelles.
#   docker compose stop app
#   docker compose run --rm --entrypoint sh backup /scripts/restore.sh 2026-10-27_030000
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
for f in "$db" "$files"; do
  [ -f "$f" ] || { echo "Introuvable : $f (il faut la base ET les images)" >&2; exit 1; }
done

# 1. Vérifier les deux archives avant de toucher à quoi que ce soit.
echo "Vérification des archives…"
pg_restore --list "$db" >/dev/null
tmp=$(mktemp -d /tmp/restore.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$files" -C "$tmp"
[ -d "$tmp/uploads" ] || { echo "Archive d'images invalide : $files" >&2; exit 1; }

# 2. Base de données.
echo "Restauration de la base depuis $db…"
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$PGDATABASE" "$db"

# 3. Images : remplacées seulement maintenant que l'extraction a réussi.
echo "Restauration des images depuis $files…"
find /data/uploads -mindepth 1 -delete
cp -a "$tmp/uploads/." /data/uploads/
echo "Restauration terminée."
