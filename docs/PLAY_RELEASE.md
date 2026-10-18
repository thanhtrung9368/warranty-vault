# Publishing to Play internal testing

Tagged releases build, sign and upload the bundle automatically. This is the
Android counterpart of `TestFlight`: `internal` is the fastest track, needs no
store-listing review for updates, and reaches testers in minutes.

## One-time setup

### 1. The upload keystore, in GitHub

The bundle must be signed with the same upload key Play already trusts. Base64 it:

```bash
base64 -i android/keystore/warrly-upload.jks | tr -d '\n'
```

Add two repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `UPLOAD_KEYSTORE_BASE64` | the base64 above |
| `UPLOAD_KEYSTORE_PASSWORD` | the `storePassword` in `android/keystore.properties` |

The alias is `warrly-upload` and the key password equals the store password —
the workflow writes `keystore.properties` from these two secrets, so nothing else
is needed.

### 2. A Play service account, in GitHub

1. Play Console → **Setup → API access** → link a Google Cloud project.
2. In that Cloud project: **IAM → Service Accounts → Create**, then create a JSON
   key for it and download it once.
3. Back in Play Console → **Users and permissions** → invite the service
   account's email → grant **Release to testing tracks** (and *Admin* if you also
   want it to manage tracks).
4. Add the JSON file's **contents** as the repository secret
   `ANDROID_PUBLISHER_CREDENTIALS`.

Gradle Play Publisher reads that variable directly, so the key is never written to
disk and never committed. `android/app/build.gradle.kts` only applies the plugin
when it (or a local `app/play-service-account.json`) is present, which is why an
ordinary build and CI's test workflow need no Play credentials at all.

### 3. The app must already exist in Play

The API cannot create an app. `com.warrly` exists, but Play also needs the
**first** release uploaded through the web UI, plus the app-content declarations
(privacy policy, data safety, content rating, target audience) completed. After
that first upload, every later release can go through this workflow.

## Releasing

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Or run the `android-release` workflow manually and pick a track. It uploads to
`internal` by default; pass `alpha`, `beta` or `production` to promote.

## What the workflow will not do

- **It does not bump `versionCode`.** Play rejects a reused code, and the Gradle
  side is configured to fail fast rather than discover it mid-upload. Bump
  `versionCode` in `android/app/build.gradle.kts` in the same commit that changes
  the release, or the tag push fails.
- **It does not fill release notes.** Play will accept a release without them, but
  testers see nothing new to read.
