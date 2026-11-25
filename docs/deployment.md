# Static deployment

Loconvert publishes the Vite `dist/` artifact with Caddy. The site serves `index.html` for client routes such as `/video/trim`. Requests under `/assets/` and paths ending in a filename extension are served as files and return HTTP 404 when missing. Keep extensionless static files under `/assets/`.

HTML and stable files such as `theme-init.js` and `assets/icon.svg` use `Cache-Control: no-cache`. Vite outputs under `assets/` with an eight-character hash before the extension use `public, max-age=31536000, immutable`. Reserve that naming pattern for Vite outputs.

## Prepare the host

Run Caddy with [deploy/Caddyfile](../deploy/Caddyfile). Set `LOCONVERT_SITE` to the site's hostname in Caddy's environment so Caddy manages HTTPS. For public HTTPS, point DNS at the host and make ports 80 and 443 reachable. Set `LOCONVERT_ROOT` to the release directory if it differs from `/srv/loconvert`. Caddy needs read access and the release operator needs write access there. Keep the directory on one filesystem.

Validate with `caddy validate --config deploy/Caddyfile --adapter caddyfile` using the same environment as the running Caddy process. After publishing the first release, start the site with `caddy run --config deploy/Caddyfile --adapter caddyfile` or point your Caddy service at that file. Subsequent release switches require no Caddy reload.

## Stage a release

Run the following in Bash on the hosting machine with GNU coreutils. Use an existing verified `dist/`, or generate it with `npm ci` and `npm run build` on the build machine before transferring it. Choose a new release ID such as the artifact's commit SHA. Run staging and switching serially with other deploys and rollbacks.

```bash
root=/srv/loconvert
release=REPLACE_WITH_RELEASE_ID
artifact=/path/to/dist

(
  set -euo pipefail
  umask 022
  test -s "$artifact/index.html"
  mkdir -p "$root/releases" "$root/shared/assets"
  test ! -e "$root/releases/$release"

  stage=$(mktemp -d "$root/releases/.stage.XXXXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  cp -R "$artifact/." "$stage/"
  chmod 755 "$stage"

  for file in "$stage"/assets/*; do
    name=${file##*/}
    if [[ -f "$file" && "$name" =~ -[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$ ]]; then
      shared="$root/shared/assets/$name"
      if [[ -e "$shared" ]]; then
        cmp -- "$file" "$shared"
      else
        ln -- "$file" "$shared"
      fi
    fi
  done

  mv -T -- "$stage" "$root/releases/$release"
)
```

The shared directory keeps hashed URLs from prior releases available to open tabs. A reused filename must contain identical bytes. Treat published releases and shared files as read-only. Retain the previous release directory for rollback and keep the shared hashes from every release whose open tabs may still be in use. Without a defined maximum tab lifetime, retain all published hashes.

## Switch or roll back

Record `readlink "$root/current"` before switching an existing site. Use the staged ID to publish, or set `release` to the recorded release's ID to roll back. Both operations use the same atomic symlink replacement.

```bash
(
  set -euo pipefail
  test -s "$root/releases/$release/index.html"
  switch=$(mktemp -d "$root/.switch.XXXXXXXX")
  trap 'rm -rf -- "$switch"' EXIT
  ln -s "releases/$release" "$switch/current"
  mv -Tf -- "$switch/current" "$root/current"
)
```

After switching, verify that `/video/trim` returns HTTP 200 with the new HTML and `Cache-Control: no-cache`. Check that `/assets/icon.svg` and `/theme-init.js` return 200 with `no-cache`, a hashed asset returns 200 with `immutable`, and `/assets/missing.js` and `/missing.js` return HTTP 404. From a tab opened before the switch, open a tool it has yet to load and confirm that its lazy chunk still loads.
