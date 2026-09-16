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
