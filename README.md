# airdcpp-sfv-folder-checker

Hub command /sfvcheck <folder> that recursively checks a folder for .sfv
files and compares their CRC32 against the real files on disk. Works
together with airdcpp-release-fixxer.

- /sfvcheck [folder] [full] — searches a folder (and subfolders) for .sfv files and checks the CRC32 of every listed file against what is actually on disk, using the real path (not the virtual share name).
  [folder] can also be set within the extension itself, in which case /sfvcheck without a path is enough.
  Add "full" (/sfvcheck [folder] full) to ignore the incremental cache and re-hash every file, regardless of modification date.
- /sfvstop — cancels a running scan. The current file is still finished, after which the scan stops cleanly. Whatever has already been checked up to that point stays in the cache and the report.
- Native CRC32 (via zlib, Node.js 21+) instead of a JS implementation — tens of times faster. On older Node versions the extension automatically falls back to a JS implementation; which path is active is reported in the system log when the extension starts.
- Retry on stat/hash errors: automatically retried up to 3 times with a short pause in between before it's reported as a real problem.
- Processes multiple release folders at once (configurable count, default 8). Files within 1 release folder are always hashed one after another; only different release folders run in parallel.
- Incremental cache (configurable, on by default): remembers file size + modification date per file after a successful check, so unchanged files are skipped on the next /sfvcheck.
  NOTE: relies on the filesystem's modification date; bitrot that doesn't change it won't be caught. Run /sfvcheck [folder] full occasionally as an extra check.
- Automatic cache cleanup: entries not seen for a configurable number of days (default 90) are removed after each scan. Set to 0 to disable.
- After a scan in which files were deleted (CRC mismatch), the built-in client "Optimize database" action is triggered once to clean up orphaned hash records. Can be turned off.
- Progress messages in the system log during a scan (max. once every 5 sec.), indicating whether a file came from the cache.
- JSON report per scan (in the extension's log folder) with all results, for airdcpp-release-fixxer to read.
- Optional (on by default): automatically delete files with a CRC mismatch, so they can be redownloaded — applies to every mismatch, including ones that came from the cache.
- Safety net around that automatic deletion: if a scan finds more mismatches than a configured count or percentage of everything checked, deletion is skipped entirely for that scan (and reported loudly instead) — protects against something systemic (a dropped network mount, a share moved mid-scan) making a mass of files look corrupt and getting mass-deleted for no real reason.
- A .sfv file that's readable but has no valid, parseable lines at all (empty, comments-only, or malformed) is now reported as a problem (`unparseable`) instead of silently vanishing from the report — and, optional (on by default), automatically deleted and its release folder searched for again, same as a CRC mismatch.
- As soon as a file is deleted (CRC mismatch or broken sfv), the extension searches for and downloads the corresponding release folder itself. Multiple deleted files from the same release folder within 1 scan only trigger 1 search. Searches happen one at a time with a configurable pause in between (default 15 sec.), using the lowest search priority (1) so manual searches/downloads always get sent to the hub first. A minimum-sources setting (default 1, i.e. no restriction) can require more than just a single found source before that automatic download is queued.
- Old scan report files (in the extension's log folder) are cleaned up automatically after a configurable number of days (default 90), same idea as the incremental-cache cleanup. Set to 0 to disable.
- Right-click "Check SFV/CRC for this folder" on folders in Own filelist. The extension logs to the system log at startup whether the menu item registered successfully, failed, or was skipped — check that log line if the menu item doesn't appear.

Settings:
- Default folder to scan — real disk path, used when /sfvcheck is typed without a path.
- Number of release folders to process at once — default 8.
- Only re-hash changed files — the incremental cache, on by default.
- Clean up cache entries after (days) not seen — default 90.
- Clean up old scan report files after (days) — default 90, 0 = never.
- Automatically delete files with a CRC mismatch — on by default.
- Skip automatic deletion if more than N mismatches are found in one scan — default 50, 0 = no limit.
- Skip automatic deletion if more than X% of checked files mismatch — default 25, 0 = no limit.
- Automatically delete SFV files with no valid, parseable lines — on by default.
- Automatically redownload deleted (CRC mismatch or broken sfv) files — on by default.
- Minimum number of hub search results required before an automatic redownload is queued — default 1 (no restriction).
- Wait time (seconds) between automatic redownload searches — default 15.
- Clean up the client's hash database after deleted files — on by default.

## What is new in each version
[Changelog](https://github.com/sharefixxers/airdcpp-sfv-folder-checker/blob/master/CHANGELOG.md)

## Troubleshooting
Enable extension debug mode from application settings and check the extension error logs
`(Settings\Extensions\airdcpp-sfv-folder-checker\logs)` for additional information.
