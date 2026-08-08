#!/usr/bin/env bash
set -euo pipefail

source_archive=${1:?source archive is required}
web_archive=${2:?web archive is required}
version=${3:?version is required}
run_id=${4:?run id is required}

base=/opt/echodeck
public_root=/opt/niz/deploy/download
stamp="${version}-${run_id}"
incoming="$base/.incoming/$stamp"
backup="$base/.deploy-backups/$stamp"
candidate_image="poio/server:${version}-${run_id}"
stable_image="poio/server:${version}"

if [[ "$(readlink -f "$base")" != /opt/echodeck ]]; then
  echo "Unexpected POIO base directory" >&2
  exit 1
fi
if [[ "$incoming" != /opt/echodeck/.incoming/* ]] || [[ "$backup" != /opt/echodeck/.deploy-backups/* ]]; then
  echo "Unsafe deployment path" >&2
  exit 1
fi
test -f "$base/.env"
test -f "$source_archive"
test -f "$web_archive"

rm -rf "$incoming"
mkdir -p "$incoming/source" "$incoming/web" "$backup"
tar -xzf "$source_archive" -C "$incoming/source"
tar -xzf "$web_archive" -C "$incoming/web"
test -f "$incoming/source/apps/server/package.json"
test -f "$incoming/source/deploy/download/index.html"
test -f "$incoming/source/deploy/download/android-update.json"
test -f "$incoming/web/index.html"

sudo docker build --pull=false --tag "$candidate_image" "$incoming/source"

previous_image=$(sudo docker inspect --format '{{.Image}}' poio-server)
tar -czf "$backup/source.tgz" -C "$base" \
  package.json package-lock.json Dockerfile docker-compose.yml apps/server deploy/download
if [[ -d "$public_root/poio-web/current" ]]; then
  sudo tar -czf "$backup/web.tgz" -C "$public_root/poio-web" current
fi

rollback() {
  status=$?
  trap - ERR
  set +e
  echo "Deployment failed; restoring the previous POIO release." >&2
  sudo docker compose -f "$base/docker-compose.yml" stop server
  sudo rm -rf "$base/apps/server" "$base/deploy/download"
  sudo tar -xzf "$backup/source.tgz" -C "$base"
  sudo docker tag "$previous_image" "$(awk '/image: poio\/server:/{print $2; exit}' "$base/docker-compose.yml")"
  sudo docker compose -f "$base/docker-compose.yml" up -d --no-deps server
  if [[ -f "$backup/web.tgz" ]]; then
    sudo rm -rf "$public_root/poio-web/current"
    sudo tar -xzf "$backup/web.tgz" -C "$public_root/poio-web"
  fi
  exit "$status"
}
trap rollback ERR

sudo docker compose -f "$base/docker-compose.yml" stop server
cp -a "$base/data/echodeck.db" "$backup/echodeck.db"
for suffix in -wal -shm; do
  if [[ -f "$base/data/echodeck.db$suffix" ]]; then
    cp -a "$base/data/echodeck.db$suffix" "$backup/echodeck.db$suffix"
  fi
done

sudo rm -rf "$base/apps/server" "$base/deploy/download"
sudo cp -a "$incoming/source/apps/server" "$base/apps/server"
sudo cp -a "$incoming/source/deploy/download" "$base/deploy/download"
sudo cp -a "$incoming/source/package.json" "$incoming/source/package-lock.json" \
  "$incoming/source/Dockerfile" "$incoming/source/docker-compose.yml" "$base/"

sudo docker tag "$candidate_image" "$stable_image"
sudo docker compose -f "$base/docker-compose.yml" up -d --no-deps server

healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:17920/health > "$incoming/health.json"; then
    healthy=1
    break
  fi
  sleep 2
done
test "$healthy" -eq 1
grep -q "\"version\":\"$version\"" "$incoming/health.json"

next_web="$public_root/poio-web/current.next-$stamp"
previous_web="$public_root/poio-web/previous-$stamp"
sudo rm -rf "$next_web"
sudo mkdir -p "$next_web"
sudo cp -a "$incoming/web/." "$next_web/"
test -f "$next_web/index.html"
if [[ -d "$public_root/poio-web/current" ]]; then
  sudo mv "$public_root/poio-web/current" "$previous_web"
fi
sudo mv "$next_web" "$public_root/poio-web/current"
sudo cp -a "$base/deploy/download/index.html" "$public_root/index.html"
sudo cp -a "$base/deploy/download/android-update.json" "$public_root/android-update.json"

curl --fail --silent --show-error --insecure "https://115.159.222.29/poio/health" | grep -q "\"version\":\"$version\""
curl --fail --silent --show-error --insecure "https://115.159.222.29/poio/web/" | grep -q '<div id="root"></div>'

trap - ERR
rm -rf "$incoming"
echo "POIO $version deployed successfully."
