# Static deployment

Arcane runs one Compose project, `loconvert`, from `/mnt/appdata/apps/arcane/projects/loconvert`. Apache serves the prebuilt Vite `dist/` at `http://192.168.0.199:3052`. The Compose mounts use the Docker host’s absolute project path so Arcane can recreate the service from inside its own container. Set `LOCONVERT_PROJECT_DIR` when installing elsewhere.

## Install the project files

On the Arcane host, set `repo` to the absolute path of the repository checkout. Run these commands as an operator with write access to the project directory. The publish script uses Bash, GNU coreutils, and `flock`.

```bash
repo=/path/to/loconvert
project=/mnt/appdata/apps/arcane/projects/loconvert

mkdir -p "$project"
cd "$project"
install -m 0644 "$repo/deploy/docker-compose.yml" "$repo/deploy/httpd.conf" "$project/"
```

## Stage and publish

Run from the project directory. Set `artifact` to the transferred `dist/` directory and `release` to the full Git commit SHA of that artifact.

```bash
artifact=/path/to/dist
release=FULL_GIT_COMMIT_SHA

bash "$repo/deploy/publish.sh" stage "$release" "$artifact"
```

Staging copies the artifact to `./site/releases/<git sha>`. Staging the same SHA again checks that the artifact matches the recorded release. Vite outputs with eight-character content hashes are retained in `./site/shared/assets` so tabs opened before a deploy can still load their chunks. An existing hash filename must match byte for byte. Treat published files as read-only. Keep release directories for rollback and retain shared hashes for as long as tabs might still request them.

Record the current target before switching an existing site. Switch only after staging succeeds.

```bash
readlink ./site/current  # On an existing site, record releases/<git sha>.
bash "$repo/deploy/publish.sh" switch "$release"
```

The switch atomically replaces `./site/current` with a relative symlink to `releases/<git sha>`. After the first switch, start the app in Arcane or run this command from the same project directory. Later release switches take effect without restarting Apache.

```bash
docker compose -p loconvert up -d
```

## Roll back

Use the SHA from the previously recorded symlink target.

```bash
bash "$repo/deploy/publish.sh" switch "$previous_release"
```

## Verify HTTP responses

Check that `/video/trim` serves the release HTML with HTTP 200 and `Cache-Control: no-cache`. Check that `/theme-init.js` returns 200 with `no-cache`, a Vite hashed asset returns 200 with `public, max-age=31536000, immutable`, and `/assets/missing.js` and `/missing.js` return 404. From a tab opened before publishing, open a tool it has yet to load to check that retained chunks still work.

## Use camera and secure browser APIs

Browsers treat the LAN HTTP address as an insecure context, so features that require a secure context, such as camera access through `getUserMedia()`, are unavailable there. From your workstation, forward a localhost port through SSH to the Arcane host using your SSH account.

```bash
ssh -N -L 127.0.0.1:3052:192.168.0.199:3052 your-user@192.168.0.199
```

Keep the SSH session open and visit `http://localhost:3052`. Browsers treat localhost as a secure context and can prompt for camera or image clipboard access there. On the direct LAN HTTP address, **Copy** opens the finished image so you can right-click or press and hold it and choose **Copy Image**.
