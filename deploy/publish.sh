#!/usr/bin/env bash
set -euo pipefail
umask 022

action=${1:-}
release=${2:-}
if ! [[ "$release" =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ ]] ||
  ! { [[ "$action" == stage && $# == 3 ]] || [[ "$action" == switch && $# == 2 ]]; }; then
  printf 'Usage: bash publish.sh stage <full-git-sha> <dist> | switch <full-git-sha>\n' >&2
  exit 2
fi

site=./site
destination="$site/releases/$release"
mkdir -p -- "$site/releases" "$site/shared/assets"
# Arcane's project directory may set inherited permissions on new directories.
chmod a+rx -- "$site" "$site/releases" "$site/shared" "$site/shared/assets"
exec 9>"$site/.publish.lock"
flock 9

temporary=
trap 'if [[ -n "$temporary" ]]; then rm -rf -- "$temporary"; fi' EXIT

if [[ "$action" == switch ]]; then
  test -s "$destination/index.html"
  temporary=$(mktemp -d "$site/.switch.XXXXXXXX")
  ln -s "releases/$release" "$temporary/current"
  mv -Tf -- "$temporary/current" "$site/current"
  exit
fi

artifact=$3
test -s "$artifact/index.html"
if [[ -e "$destination" ]]; then
  diff -qr -- "$artifact" "$destination"
  exit
fi

temporary=$(mktemp -d "$site/releases/.stage.XXXXXXXX")
cp -R -- "$artifact/." "$temporary/"
chmod -R a+rX -- "$temporary"

hashed_assets=()
for file in "$temporary"/assets/*; do
  name=${file##*/}
  if [[ -f "$file" && "$name" =~ -[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$ ]]; then
    hashed_assets+=("$file")
    shared="$site/shared/assets/$name"
    if [[ -e "$shared" ]]; then
      cmp -- "$file" "$shared"
    fi
  fi
done

for file in "${hashed_assets[@]}"; do
  shared="$site/shared/assets/${file##*/}"
  if [[ ! -e "$shared" ]]; then
    ln -- "$file" "$shared"
  fi
done

mv -T -- "$temporary" "$destination"
