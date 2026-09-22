## Notes (1.0.0)

No longer beta: version reset to 1.0.0 to mark the extension stable,
following semantic versioning convention (the 0.x/`-beta` range signals
"may still change", 1.0.0 signals a settled, stable feature set). No
functional change on its own.

Also fixed, found during a last settings-screen check before this version
bump: the "(0 = no limit)"/"(0 = never)" qualifier at the end of a long
setting title (`max_auto_delete_count`, `max_auto_delete_percent`,
`report_max_age_days`) could get cut off or overlap the input field next
to it in the client's Settings screen. Moved to the start of each
setting's help text instead, which always renders on its own line.

## Notes (1.2.21-beta)

Editorial pass over the Settings screen text (reviewed together, several
rounds back and forth): shortened several titles, standardized "CRC
mismatch" to "CRC error" in the four settings that mention it
(`delete_mismatches`, `max_auto_delete_count`, `max_auto_delete_percent`,
`redownload_on_delete` -- kept as the shorter word by choice, this is
distinct from the file-not-readable case those settings never covered),
fixed two grammar mistakes introduced during that pass (a missing "of" in
`max_auto_delete_percent`'s title, "be redownload" -> "be redownloaded" in
`delete_unparseable_sfv`), and trimmed the help text on
`delete_persistent_errors` and `recheck_errors_after_scan`. The matching
"Settings:" list in this file was updated to stay in sync with the actual
setting titles. No functional change -- only setting titles/help text and
this doc.

## Notes (1.2.20-beta)

Fixed the GitHub URLs in package.json (`bugs`, `repository`): they
pointed at a shared `sharefixxers/airdcpp-extensions` monorepo path
that doesn't exist, instead of this extension's own dedicated
repository. Now `https://github.com/sharefixxers/airdcpp-sfv-folder-checker`,
matching every other extension in the family. No functional change.

## Notes (1.2.19-beta)

Editorial pass over this file: removed meta-commentary about how/why a
change came about (phrasing like "requested directly"/"per request")
from every changelog entry, keeping only what actually changed. No
functional change.

## Notes (1.2.18-beta)

/sfvcheck (and the default folder setting) now accept multiple folders at
once, comma-separated (`/sfvcheck folder1,folder2,folder3`), checked one
after another.

- All given folders are validated up front (must exist and be a real
  directory) before any scanning starts -- one bad path in the list means
  nothing gets scanned rather than only failing partway through.
- One shared cache, concurrency setting and stop flag are used across the
  whole sequence, so /sfvstop during a multi-folder run cancels the
  sequence cleanly after the current folder's current file finishes,
  instead of only stopping the folder in progress.
- Each folder is still reported, logged and written to its own JSON
  report exactly as a single /sfvcheck always was -- a folder failing
  (e.g. missing mid-scan, permission error) is logged and skipped rather
  than aborting the remaining folders in the list.
- Single-folder behavior (/sfvcheck with one path, or a default folder
  with no comma) is unchanged.

## Notes (1.2.17-beta)

Extended the 1.2.16-beta post-scan recheck (below) in two ways, right
after seeing it run on the real EISDIR case:

- The recheck can now try more than once: still-erroring files are
  rechecked repeatedly, each attempt separated by the same configurable
  pause, up to a new "Maximum number of recheck attempts before giving
  up" setting (default 4 -- so, at default settings, up to a minute
  total before giving up). Only files still failing are retried on each
  attempt, so one that recovers early stops being touched.
- A file that's still failing after every recheck attempt is now
  treated the same as a confirmed CRC mismatch: deleted and its release
  folder searched for again (new "Automatically delete files that still
  fail with a read/CRC error" setting, on by default), counted alongside
  CRC mismatches for the existing mass-deletion safety cap (so something
  systemic still gets reported instead of deleted), and triggering the
  same hash-database cleanup and redownload as a mismatch deletion.

Verified standalone: a file that stays broken through every attempt is
still reported/deleted correctly after the configured maximum, and one
that recovers partway through stops the loop early instead of running
out the remaining attempts.

## Notes (1.2.16-beta)

Added an optional post-scan recheck for files that end a scan with a
read/CRC error (`Could not read file: ...` / `Could not calculate CRC:
...`), on by default: after the whole scan finishes, any such files got
one more check following a configurable pause (default 15 sec., "Seconds
to wait before each recheck attempt" setting -- see 1.2.17-beta above
for the repeated-attempts version this grew into). If the recheck
succeeded the file was reported normally (ok/mismatch) instead of as an
error; if it failed again, it was reported as an error exactly as
before.

Prompted by a real case: a release folder's `.r62` volume repeatedly
failed with `EISDIR: illegal operation on a directory, read` while being
read over a mapped network drive (`z:\...`), twice in a row, each time
after the scan stalled on it for several minutes -- while the file
itself, checked directly on disk right after, was a completely ordinary
100 MB file identical to its sibling volumes. The existing stat/hash
retry (3 attempts, ~300ms apart) is meant for a quick hiccup and isn't
long enough for a stall like that; this recheck runs after the full
scan, by which point a passing network glitch has usually cleared on
its own. Can be turned off ("Recheck files that failed with a read/CRC
error after the scan finishes") to go back to reporting a read/CRC
error immediately after the initial retries.

## Notes (1.2.15-beta)

Cosmetic-only pass, requested directly: every user-facing/prose mention of
the "AirDC++" product name (in a settings title, README text, and code
comments) is now generic "the client" instead, since this extension
family targets both AirDC++ and FulDC++. Technical identifiers that have
to keep the literal name -- the npm dependency names, this package's own
name/keywords/repository fields (required to start with `airdcpp-` for
the settings-registration API to work, see "Notes (1.2.6-beta)" below),
and the `airdcpp` block in `package.json` -- are untouched. No
functional change.

## Notes (1.2.14-beta)

Cosmetic-only pass over the Settings screen text, requested directly:
shortened several help texts for clarity (the CRC-mismatch safety cap,
the unparseable-SFV deletion setting, the minimum-sources setting, and
the report cleanup setting), and dropped ", parseable" from the
unparseable-SFV setting's title. No functional change -- all keys,
defaults and min/max values are unchanged.

## Notes (1.2.13-beta)

Cosmetic fix, requested directly: the periodic "Progress" log line during
a scan (`Progress "<path>": N/M files checked (last: <file>).`) had a redundant
"last: " before the file name -- it's already obvious from the wording that it's
the most recently checked file. Removed, so the line now just reads `... files checked
(<file>).`. No functional change.

## Notes (1.2.12-beta)

Four incremental fixes from a "just for fun" brainstorm about the
remaining rough spots in the auto-delete/auto-redownload machinery:

- **Safety cap on automatic deletion.** New settings `max_auto_delete_count`
  (default 50) and `max_auto_delete_percent` (default 25, either 0 =
  disabled) -- if a scan's CRC mismatches exceed either limit, nothing is
  deleted automatically for that scan; it's reported instead. Protects
  against something systemic (a dropped network mount, a share moved
  mid-scan) making a mass of files look corrupt and getting mass-deleted
  for no real reason.
- **A broken/unreadable .sfv is no longer silently invisible.** A `.sfv`
  file that reads fine but has zero valid, parseable lines (empty,
  comments-only, or malformed) previously just vanished from the scan --
  no problem entry, no warning, nothing. It's now reported as a new
  `unparseable` status, and -- per request, since a broken SFV can't be
  checked against anything anyway -- automatically deleted (new setting
  `delete_unparseable_sfv`, on by default) with its release folder queued
  for a fresh search/redownload, same handling as a deleted CRC-mismatch
  file.
- **Old scan reports now clean up after themselves.** New setting
  `report_max_age_days` (default 90, matching the existing cache cleanup
  setting) removes old `reports/*.json` files -- that folder previously
  grew forever, one file per scan.
- **The auto-redownload search no longer blindly grabs the first
  result.** New setting `min_sources_for_redownload` (default 1, i.e. no
  behavior change) requires at least that many sources to be found before
  the top result is trusted enough to queue automatically -- raise it to
  avoid auto-queueing a download based on a single, possibly unreliable
  source.

All four verified standalone (real scan against comments-only/empty .sfv
fixtures confirming the new `unparseable` status and that a normal valid
.sfv still checks out fine; `pruneReports` against a mix of old/recent/
unrelated files; the count/percentage safety-cap math; the minimum-sources
gate) before wiring into the extension itself.

## Notes (1.2.9-beta)

`/sfvhelp` (and `/sfvcheck help`) now shows the help text as a clear
list of commands, one per line, instead of one long paragraph -- and
the reply always appears in the same hub/PM window the command was
typed in (it already did; only the text layout changed).

## Notes (1.2.8-beta)

Fixed a bug where `/sfvcheck help` was silently stat()'d as a literal
folder path (`help`), instead of showing usage -- resulted in a
confusing "Folder not found: help" (or, if a scan happened to already
be running, an unrelated "already running" message). The separate
`/sfvhelp` command already worked correctly and is unchanged; this just
also catches the more natural `<command> help` typing pattern (only
when "help" is the entire path argument, checked after the "full"
modifier is stripped -- a real path is still free to contain the
word). Same class of bug found and fixed at the same time in
airdcpp-sample-proof-checker and airdcpp-share-backup.

## Notes (1.2.6-beta)

Reverted the 1.2.5-beta rename: back to airdcpp-sfv-folder-checker (and
the sibling references above back to airdcpp-release-fixxer /
airdcpp-sample-proof-checker). Turns out the official "name must start
with airdcpp-" requirement is real after all, just narrower than a
quick test had suggested -- a minimal test extension with no settings
(dce-hello-fixxer) loaded, ran, and handled chat commands fine under a
non-airdcpp--prefixed name, which looked like proof the whole
requirement was obsolete. But every real extension in this family uses
settings, and the client rejects the settings-registration API call (POST
extensions/<name>/settings/definitions) for a non-airdcpp--prefixed
name -- confirmed with an isolated one-line diff (only name/version
changed, nothing else) that reproduced a clean crash: a 400 on that
endpoint, silently swallowed by the settings library, followed by a
hard crash the moment any setting was read. Confirmed consistent even
after a full client restart, so not a one-time registration race
either. Back to airdcpp- for good. No functional change otherwise.

## Notes (1.2.5-beta)

Renamed the package from `airdcpp-sfv-folder-checker` to
`airdcpp-sfv-folder-checker` (and its sibling `airdcpp-release-fixxer` /
`airdcpp-sample-proof-checker` references above to `airdcpp-release-fixxer`
/ `airdcpp-sample-proof-checker`). The client's official extension spec says a
package name "must start with airdcpp-", but that turned out to only
apply to extensions published through npm's own registry and picked up
via the client's in-app update checker -- a locally-installed or
FulDC++-catalogue extension with a non-`airdcpp-`-prefixed name loads
and runs identically (confirmed with a small purpose-built test
extension, installed manually and via `dce-tiny-fileserver`'s
auto-install, in a real client, version 4.30). Since this whole family is only
ever installed that way, `dce-` (Direct Connect Extension) reads better
than a name implying it only works with one specific client. No
functional change otherwise.

## Notes (1.2.4-beta)

Added `repository` and `bugs` fields to `package.json` (placeholder
GitHub URL -- replace `YOUR-USERNAME-HERE` with the real account/repo
before actually running `npm publish`), and flipped `private` from
`true` back to `false` in preparation for an eventual real npm publish.
Until that publish actually happens, this brings back the npmjs.org
update-check 404 that `private: true` had deliberately silenced --
harmless, just a log line, and easy to re-suppress by setting `private`
back to `true` for anyone installing from source/zip rather than a real
npm publish. Also note: this doc's version header above ("b1.2.1") was
stale before this update -- the actual shipped version has been
1.2.3-beta/1.2.4-beta for a while; only the number in this file's first
line hadn't been kept in sync.
