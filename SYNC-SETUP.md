# Shared GPX Library

Prepared locally; not published or tested with a real GitHub write token.

## Publish together

Commit `index.html`, `github-sync.js`, `migration-baselines.json`, and `track-library.json` to the GitHub Pages source branch of `genius2go/gpx-library` (currently configured in this update as `main`). Keep the existing three original backups in the recovery package outside this deployment. The master seed has 15 records; the exact duplicate recording remains under its two original IDs.

The app reads the master from GitHub's API, not a potentially stale Pages copy. No API token belongs in committed files. Branch rules must permit the token's update requests. If direct writes to main are prohibited, use a dedicated permitted data branch and adjust SYNC_TARGET before deployment.

After deployment, open GPX Library on each device, choose GitHub sync, and enter a personal access token authorized for this repository with Contents read and write access. This is credential setup only; do not restore separate master files on each device. A token restricted to delivery-planner needs gpx-library added to its repository access. The app does not inspect or copy credentials from other sites.

## Behavior

- Fetch on opening, returning to the tab, regaining connectivity, clicking Sync now, and every minute while visible.
- Save edits locally first and attempt GitHub upload after a short delay.
- A small per-field hash baseline is stored with the local cache. It is never uploaded or included in exported backups. The token uses a separate browser storage key and is excluded from both.
- Exact copies of the three audited backups are recognized by hashes and adopt the seed's merged edits. Any unknown or subsequently edited snapshot is merged conservatively; unresolved same-field edits create labeled conflict copies with provenance.
- Independent field edits merge. Competing versions retain their data; the shared version keeps its ID, and the local version becomes a deterministic conflict copy. Delete/edit conflicts preserve the edited record under a new conflict ID and retain the original deletion.
- Imported and built-in deletions persist as tombstones. Unchanged stale devices do not resurrect deleted records. An unknown old snapshot conflicting with a tombstone is retained as a conflict copy for review.
- Writes include GitHub's current file SHA. Stale writes refetch and remerge up to three attempts. Local storage failure stops the upload. Concurrent-tab storage changes stop writes until reload.
- Offline edits remain pending across reload. Local storage is a working cache and outbox; GitHub is the shared authority. Browser storage limits and availability still apply.
- An edit form or active import defers synchronization. Local saves during a sync are rejected with the edit left open for retry.

Backups remain version 2 JSON with the added `deletedTrackIds` field. Older app versions ignore imported-track tombstones, so use the updated app on every device. Restore is an explicit replacement of the local library and schedules synchronization; use Back up before restoring older data.

## Validation performed

`node sync.test.cjs` passes core merge and API tests covering independent edits, competing edits, retry idempotence, deletion versus edit, unknown migrations, different-ID duplicates, removed fields, immutable SHA-pinned reads, Unicode encoding, and API error statuses.

Additional local integration tests execute the actual page script with simulated storage and GitHub responses: initial shared load, stale-write retry, offline edit/reload/recovery, competing edits, deletion propagation to a stale session, all three actual audited-backup migrations, exclusion of the test token from payloads, storage quota failure before upload, and cross-tab overwrite protection. These pass. The settings dialog was also inspected in the in-app browser. A real authenticated GitHub save and full live multi-device acceptance test remain for deployment.

## Acceptance after deployment

1. Confirm all devices report the same master count and no pending changes.
2. Add a temporary tag on iPhone; verify it appears on Mac and iPad after returning to those tabs.
3. Test independent edits and a deliberate competing edit; verify both competing values survive.
4. Test an offline edit, reload while offline, then reconnect and verify the edit syncs.
5. Delete a disposable test import and verify an older device cannot resurrect it.

GitHub retains committed history for recovery. Never delete your original backups during rollout.
