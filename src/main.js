'use strict';

"use strict";

  const fs = require('fs');
  const fsp = fs.promises;
  const path = require('path');
  const {
    scanFolder,
    writeReport,
    pruneCache,
    pruneReports,
    HAS_NATIVE_CRC32
  } = require('./lib');
  const SettingsManager = require('airdcpp-extension-settings');

  const EXTENSION_TAG = 'sfv-folder-checker';

  const PROGRESS_LOG_INTERVAL_MS = 5000;

  const SettingDefinitions = [{
    key: 'default_directory',
    title: 'Folder to scan',
    help: 'Comma-separate multiple folders to check with /sfvcheck.',
    default_value: '',
    type: 'string',
    optional: true,
  }, {
    key: 'concurrency',
    title: 'Number of sfv files (releases) to process at once',
    default_value: 8,
    type: 'number',
    min: 1,
    max: 32,
  }, {
    key: 'delete_mismatches',
    title: 'Delete files with a CRC error',
    default_value: true,
    type: 'boolean',
  }, {
    key: 'max_auto_delete_count',
    title: 'Skip deletion if more than this many CRC errors are found in one scan',
    help: '0 = no limit. Safety net against mass-deleting files after something like a dropped network mount.',
    default_value: 50,
    type: 'number',
    min: 0,
    max: 100000,
  }, {
    key: 'max_auto_delete_percent',
    title: 'Skip deletion if more than this percentage of CRC errors are found',
    help: '0 = no limit. Same safety net as the count limit above, expressed as a percentage of the files checked in this scan.',
    default_value: 25,
    type: 'number',
    min: 0,
    max: 100,
  }, {
    key: 'delete_unparseable_sfv',
    title: 'Delete SFV files with no valid lines and let a valid one be redownloaded.',
    default_value: true,
    type: 'boolean',
  }, {
    key: 'min_sources_for_redownload',
    title: 'Minimum number of hub search results required before an automatic redownload is queued',
    help: 'The auto-redownload search always downloads the top result.',
    default_value: 1,
    type: 'number',
    min: 1,
    max: 20,
  }, {
    key: 'optimize_hash_db',
    title: 'Optimize client hash database after files have been deleted',
    default_value: true,
    type: 'boolean',
  }, {
    key: 'redownload_on_delete',
    title: 'Automatically re-search/redownload CRC error and deleted files',
    default_value: true,
    type: 'boolean',
  }, {
    key: 'redownload_wait_seconds',
    title: 'Wait time (seconds) between automatic re-search attempts to prevent "Search queue overflow"',
    default_value: 15,
    type: 'number',
    min: 5,
    max: 120,
  }, {
    key: 'incremental_cache',
    title: 'Only re-hash changed files (faster)',
    default_value: true,
    type: 'boolean',
  }, {
    key: 'cache_max_age_days',
    title: 'Clean up sfv check cache entries after (days) not seen',
    default_value: 90,
    type: 'number',
    min: 0,
    max: 3650,
  }, {
    key: 'report_max_age_days',
    title: 'Clean up old scan report files after (days)',
    help: '0 = never.',
    default_value: 90,
    type: 'number',
    min: 0,
    max: 3650,
  }, {
    key: 'delete_persistent_errors',
    title: 'Automatically delete files that still fail with a read/CRC error.',
    default_value: true,
    type: 'boolean',
  }, {
    key: 'recheck_errors_after_scan',
    title: 'Recheck files that failed with a read/CRC error after the scan finishes.',
    help: 'To prevent immediate action (e.g. on a brief network share hiccup).',
    default_value: true,
    type: 'boolean',
  }, {
    key: 'recheck_delay_seconds',
    title: 'Seconds to wait before each recheck attempt',
    default_value: 15,
    type: 'number',
    min: 1,
    max: 300,
  }, {
    key: 'recheck_max_attempts',
    title: 'Maximum number of recheck attempts before giving up.',
    help: 'Only files still failing are retried on each attempt, so one that recovers early stops being touched.',
    default_value: 4,
    type: 'number',
    min: 1,
    max: 20,
  }, ];

  async function loadCache(cachePath) {
    try {
      const raw = await fsp.readFile(cachePath, 'utf8');
      const data = JSON.parse(raw);
      const map = new Map();
      if (data && typeof data === 'object') {
        const now = Date.now();
        for (const key of Object.keys(data)) {
          const entry = data[key];
          if (entry && typeof entry.size === 'number' && typeof entry.mtimeMs === 'number') {

            if (typeof entry.checkedAt !== 'number') {
              entry.checkedAt = now;
            }
            map.set(key, entry);
          }
        }
      }
      return map;
    } catch (e) {

      return new Map();
    }
  }

  async function saveCache(cachePath, cache) {
    try {
      const obj = {};
      for (const [file, entry] of cache.entries()) {
        obj[file] = entry;
      }
      await fsp.writeFile(cachePath, JSON.stringify(obj), 'utf8');
    } catch (e) {
      console.error('Could not save sfv cache:', e.message || e);
    }
  }

  function sendStatus(socket, type, entityId, text) {
    if (!type || !entityId) return;
    socket
      .post(`${type}/${entityId}/status_message`, {
        text,
        severity: 'info'
      })
      .catch((e) => console.error('Could not send status message:', e.message || e));
  }

  function logEvent(socket, text, severity) {
    socket
      .post('events', {
        text: `[${EXTENSION_TAG}] ${text}`,
        severity
      })
      .catch((e) => console.error('Could not log event:', e.message || e));
  }

  async function resolveRealPaths(socket, virtualPath) {
    if (!virtualPath) return [];
    const segments = virtualPath.split('/').filter(Boolean);
    if (segments.length <= 1) return [];
    const relative = segments.slice(1).join(path.sep);
    let roots;
    try {
      roots = await socket.get('share_roots');
    } catch (e) {
      return [];
    }
    const seen = new Set();
    const candidates = [];
    for (const root of roots || []) {
      if (!root || !root.path) continue;
      const base = root.path.endsWith(path.sep) || root.path.endsWith('/') ? root.path : root.path + path.sep;
      const candidate = base + relative;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      try {
        const st = await fsp.stat(candidate);
        if (st.isDirectory()) candidates.push(candidate);
      } catch (e) {

      }
    }
    return candidates;
  }

  function createRedownloadQueue(socket, settings) {
    const lastQueuedAt = new Map();
    const queuedNow = new Set();
    const queue = [];
    let processing = false;

    const isEnabled = () => settings.getValue('redownload_on_delete') !== false;
    const getWaitMs = () => {
      const seconds = Number(settings.getValue('redownload_wait_seconds'));
      return (Number.isFinite(seconds) && seconds > 0 ? seconds : 15) * 1000;
    };

    const searchAndDownload = async (folderPath) => {
      const parentDir = path.dirname(folderPath);
      const folderName = path.basename(folderPath);
      let session;
      try {
        session = await socket.post('search');
      } catch (e) {
        logEvent(
          socket,
          `[auto-redownload] Could not start a search for folder ${folderName}: ${e.message}`,
          'error'
        );
        return;
      }
      try {
        try {
          await socket.post(`search/${session.id}/hub_search`, {
            query: {
              pattern: folderName,
              file_type: 'directory'
            },

            priority: 1,
          });
        } finally {

          await new Promise((resolve) => setTimeout(resolve, getWaitMs()));
        }
        const results = await socket.get(`search/${session.id}/results/0/5`);
        if (!results || results.length === 0) {
          logEvent(socket, `[auto-redownload] No sources found for folder: ${folderName}`, 'warning');
          return;
        }
        const minSources = Math.max(1, Number(settings.getValue('min_sources_for_redownload')) || 1);
        if (results.length < minSources) {
          logEvent(
            socket,
            `[auto-redownload] Only ${results.length} source(s) found for folder: ${folderName} -- below the ` +
              `configured minimum of ${minSources}, not downloading automatically.`,
            'warning'
          );
          return;
        }
        const top = results[0];
        await socket.post(`search/${session.id}/results/${top.id}/download`, {
          target_name: folderName,
          target_directory: parentDir + path.sep,
        });
        logEvent(
          socket,
          `[auto-redownload] Re-queued folder for download: ${folderName} (${results.length} source(s) found)`,
          'info'
        );
      } catch (e) {
        logEvent(socket, `[auto-redownload] Search/download failed for folder ${folderName}: ${e.message}`, 'error');
      } finally {
        try {
          await socket.delete(`search/${session.id}`);
        } catch (e) {}
      }
    };

    const processQueue = async () => {
      if (processing) return;
      processing = true;
      while (queue.length > 0) {
        const item = queue.shift();
        queuedNow.delete(item);
        lastQueuedAt.set(item, Date.now());
        try {
          await searchAndDownload(item);
        } catch (e) {
          logEvent(
            socket,
            `[auto-redownload] Unexpected error while processing ${item}: ${e && e.message ? e.message : e}`,
            'error'
          );
        }
      }
      processing = false;
    };

    return {
      enqueue(folderPath) {
        if (!isEnabled() || !folderPath) return;
        const key = folderPath.replace(/[\\/]+$/, '');
        const now = Date.now();
        const last = lastQueuedAt.get(key);
        if ((last && now - last < 300000) || queuedNow.has(key)) return;
        queuedNow.add(key);
        queue.push(key);
        processQueue();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Minimal, self-contained context-menu registration helper. Mirrors the
  // addContextMenuItems() helper from the airdcpp-extension package (same
  // socket.addListener('menus', <id>_menuitem_selected', ...) + socket.addHook

  function checkMenuAccess(menuItem, permissions) {
    if (!menuItem.access) return true;
    return permissions.indexOf('admin') !== -1 || permissions.indexOf(menuItem.access) !== -1;
  }

  const MENU_URLS_SUPPORT = 'urls';
  const MENU_FORM_SUPPORT = 'form';

  function menuHasSupport(support, supports) {
    return !!supports && supports.indexOf(support) !== -1;
  }

  async function validateMenuItem(menuItem, data) {
    const {
      selected_ids,
      entity_id,
      permissions,
      supports
    } = data;
    if (menuItem.urls && !menuHasSupport(MENU_URLS_SUPPORT, supports)) {
      return false;
    }
    if (menuItem.filter) {
      const filterResult = await menuItem.filter(selected_ids, entity_id, permissions, supports);
      if (!filterResult) return false;
    }
    return checkMenuAccess(menuItem, permissions);
  }

  async function parseMenuItemCallbackData(item, data) {
    const {
      selected_ids,
      entity_id,
      permissions,
      supports
    } = data;
    if (item.urls && item.urls.length) {
      const urls =
        typeof item.urls === 'function' ? await item.urls(selected_ids, entity_id, permissions, supports) : item.urls;
      return {
        urls
      };
    }
    if (item.formDefinitions && menuHasSupport(MENU_FORM_SUPPORT, supports)) {
      const form_definitions =
        typeof item.formDefinitions === 'function' ?
        await item.formDefinitions(selected_ids, entity_id, permissions, supports) :
        item.formDefinitions;
      return {
        form_definitions
      };
    }
    return {};
  }

  async function registerContextMenuItems(socket, menuItems, menuId, subscriberInfo) {
    const removeListener = await socket.addListener('menus', `${menuId}_menuitem_selected`, async (data) => {
      if (data.hook_id !== subscriberInfo.id) return;
      const menuItem = menuItems.find((i) => data.menuitem_id === i.id);
      if (!menuItem) return;
      const isValid = await validateMenuItem(menuItem, data);
      if (isValid && menuItem.onClick) {
        const {
          selected_ids,
          entity_id,
          permissions,
          supports,
          form_values
        } = data;
        menuItem.onClick(selected_ids, entity_id, permissions, supports, form_values);
      }
    });

    const removeHook = await socket.addHook(
      'menus',
      `${menuId}_list_menuitems`,
      async (data, accept, reject) => {
          const validItems = [];
          for (const item of menuItems) {
            const isValid = await validateMenuItem(item, data);
            if (!isValid) continue;
            const parsedCallbackData = await parseMenuItemCallbackData(item, data);
            const {
              onClick,
              id,
              title,
              icon
            } = item;
            if (onClick || (parsedCallbackData.urls && parsedCallbackData.urls.length)) {
              validItems.push(Object.assign({
                id,
                title,
                icon
              }, parsedCallbackData));
            }
          }
          accept({
            menuitems: validItems
          });
        },
        subscriberInfo
    );

    return () => {
      removeHook();
      removeListener();
    };
  }

  async function scanOneFolder(
    socket, extension, settings, redownloadQueue, type, entityId,
    targetPath, forceFull, stopFlag, concurrency, useCache, cache, cachePath
  ) {
    const modeText = forceFull ? ', full, cache ignored' : useCache ? ', with cache' : '';
    sendStatus(socket, type, entityId, `Scanning "${targetPath}" (${concurrency} at a time${modeText})...`);
    logEvent(socket, `Starting scan of "${targetPath}" (${concurrency} files at a time${modeText}).`, 'info');

    let lastProgressLog = Date.now();
    let lastCacheSave = Date.now();

    try {
      const {
        sfvFiles,
        results,
        stopped
      } = await scanFolder(targetPath, {
        concurrency,
        cache,
        forceFull,
        stopFlag,
        recheckErrors: settings.getValue('recheck_errors_after_scan') !== false,
        recheckDelayMs: Math.max(1, Number(settings.getValue('recheck_delay_seconds')) || 15) * 1000,
        recheckMaxAttempts: Math.max(1, Number(settings.getValue('recheck_max_attempts')) || 4),
        onProgress: (processed, total, item, fromCache) => {
          const now = Date.now();
          if (cache && now - lastCacheSave > 60000) {
            lastCacheSave = now;
            saveCache(cachePath, cache);
          }
          if (now - lastProgressLog < PROGRESS_LOG_INTERVAL_MS && processed < total) {
            return;
          }
          lastProgressLog = now;
          logEvent(
            socket,
            `Progress "${targetPath}": ${processed}/${total} files checked (${path.basename(item.file)}${
            fromCache ? ', from cache' : ''
          }).`,
            'info'
          );
        },
        onRecheckStart: (count, delayMs, attempt, maxAttempts) => {
          logEvent(
            socket,
            `${count} file(s) in "${targetPath}" still have a read/CRC error -- recheck attempt ${attempt}/` +
              `${maxAttempts} after a ${Math.round(delayMs / 1000)}s pause in case it's a transient glitch ` +
              `(e.g. a network share hiccup).`,
            'info'
          );
        },
      });

      let prunedCount = 0;
      if (cache) {
        const cacheMaxAgeDays = Number(settings.getValue('cache_max_age_days'));
        if (cacheMaxAgeDays > 0) {
          prunedCount = pruneCache(cache, cacheMaxAgeDays * 24 * 60 * 60 * 1000);
        }
        await saveCache(cachePath, cache);
      }

      const problems = results.filter((r) => r.status !== 'ok');
      const cachedCount = results.filter((r) => r.fromCache).length;

      const deleteMismatches = !!settings.getValue('delete_mismatches');
      const deletePersistentErrors = settings.getValue('delete_persistent_errors') !== false;
      const mismatches = problems.filter((p) => p.status === 'mismatch' && p.file);
      // 'error' here means still failing after the retries (and, if enabled,
      // the post-scan recheck) -- by this point it's had every reasonable
      // chance to turn out to be a transient glitch, so it's treated the
      // same as a confirmed CRC mismatch.
      const persistentErrors = problems.filter((p) => p.status === 'error' && p.file);
      const deletableCount = (deleteMismatches ? mismatches.length : 0) +
        (deletePersistentErrors ? persistentErrors.length : 0);

      // Safety net: something systemic (a dropped network mount, a share
      // moved mid-scan, ...) can make every file in a scan look corrupted or
      // unreadable at once -- auto-deleting all of those would do real
      // damage. If the combined mismatch+error count (or its share of
      // everything checked) crosses either configured limit, skip deletion
      // entirely for this scan and just report it loudly instead.
      let deleteSkippedReason = null;
      if (deletableCount > 0) {
        const maxCount = Number(settings.getValue('max_auto_delete_count')) || 0;
        const maxPercent = Number(settings.getValue('max_auto_delete_percent')) || 0;
        const percentDeletable = results.length > 0 ? (deletableCount / results.length) * 100 : 0;

        if (maxCount > 0 && deletableCount > maxCount) {
          deleteSkippedReason =
            `${deletableCount} mismatch/error file(s) found, more than the configured limit of ${maxCount}`;
        } else if (maxPercent > 0 && percentDeletable > maxPercent) {
          deleteSkippedReason =
            `${deletableCount} mismatch/error file(s) found (${percentDeletable.toFixed(1)}% of ${results.length} ` +
            `checked), more than the configured limit of ${maxPercent}%`;
        }
      }

      if (deleteSkippedReason) {
        logEvent(
          socket,
          `Automatic deletion skipped: ${deleteSkippedReason} -- looks more like a systemic problem (e.g. a ` +
            `dropped network mount) than real corruption. Check the report and delete manually if the ` +
            `mismatches/errors turn out to be real.`,
          'warning'
        );
      }

      let deletedCount = 0;
      if (deleteMismatches && !deleteSkippedReason) {
        for (const p of mismatches) {
          try {
            await fsp.unlink(p.file);
            p.deleted = true;
            deletedCount++;
            logEvent(socket, `Deleted (CRC mismatch): ${p.file} (sfv: ${p.sfv})`, 'warning');
            redownloadQueue.enqueue(path.dirname(p.file));
          } catch (e) {
            p.deleted = false;
            p.deleteError = e.message;
            logEvent(socket, `Could not delete ${p.file}: ${e.message}`, 'error');
          }
        }
      }

      let deletedErrorCount = 0;
      if (deletePersistentErrors && !deleteSkippedReason) {
        for (const p of persistentErrors) {
          try {
            await fsp.unlink(p.file);
            p.deleted = true;
            deletedErrorCount++;
            logEvent(socket, `Deleted (still failing -- ${p.message}): ${p.file} (sfv: ${p.sfv})`, 'warning');
            redownloadQueue.enqueue(path.dirname(p.file));
          } catch (e) {
            p.deleted = false;
            p.deleteError = e.message;
            logEvent(socket, `Could not delete ${p.file}: ${e.message}`, 'error');
          }
        }
      }

      const deleteUnparseable = !!settings.getValue('delete_unparseable_sfv');
      let deletedSfvCount = 0;
      if (deleteUnparseable) {
        const unparseable = problems.filter((p) => p.status === 'unparseable' && p.sfv);
        for (const p of unparseable) {
          try {
            await fsp.unlink(p.sfv);
            p.deleted = true;
            deletedSfvCount++;
            logEvent(socket, `Deleted (no valid lines could be parsed): ${p.sfv}`, 'warning');
            redownloadQueue.enqueue(path.dirname(p.sfv));
          } catch (e) {
            p.deleted = false;
            p.deleteError = e.message;
            logEvent(socket, `Could not delete ${p.sfv}: ${e.message}`, 'error');
          }
        }
      }

      let hashDbOptimizeTriggered = false;
      const totalDeletedCount = deletedCount + deletedErrorCount;
      if (totalDeletedCount > 0 && settings.getValue('optimize_hash_db') !== false) {
        try {
          await socket.post('hash/optimize_database', {
            verify: false
          });
          hashDbOptimizeTriggered = true;
          logEvent(
            socket,
            `Hash database cleanup started (${totalDeletedCount} file(s) just deleted in this scan).`,
            'info'
          );
        } catch (e) {
          logEvent(socket, `Could not start hash database cleanup: ${e.message}`, 'error');
        }
      }

      const reportDir = path.join(extension.logPath, 'reports');
      const reportPath = writeReport(targetPath, results, reportDir);

      let prunedReportsCount = 0;
      const reportMaxAgeDays = Number(settings.getValue('report_max_age_days'));
      if (reportMaxAgeDays > 0) {
        prunedReportsCount = pruneReports(reportDir, reportMaxAgeDays * 24 * 60 * 60 * 1000);
      }

      const summary =
        (stopped ? `Scan stopped (on request) after ` : `Scan complete: `) +
        `${sfvFiles.length} sfv file(s), ${results.length} line(s) checked` +
        (cachedCount ? ` (${cachedCount} from cache, ${results.length - cachedCount} actually hashed)` : '') +
        `, ${problems.length} problem(s)` +
        (deleteMismatches ? `, ${deletedCount} file(s) deleted (CRC mismatch)` : '') +
        (deletePersistentErrors ? `, ${deletedErrorCount} file(s) deleted (still failing)` : '') +
        (deleteSkippedReason ? `, deletion skipped (see log)` : '') +
        (deleteUnparseable ? `, ${deletedSfvCount} broken sfv file(s) deleted` : '') +
        (prunedCount ? `, ${prunedCount} orphaned cache entrie(s) cleaned up` : '') +
        (prunedReportsCount ? `, ${prunedReportsCount} old report(s) cleaned up` : '') +
        (hashDbOptimizeTriggered ? `, hash database cleanup started` : '') +
        `. Report: ${reportPath}`;

      sendStatus(socket, type, entityId, summary);
      logEvent(socket, summary, problems.length ? 'warning' : 'info');

      for (const p of problems) {
        let line;
        if (p.status === 'missing') {
          line = `${p.file}: file is missing from disk (sfv: ${p.sfv})`;
        } else if (p.status === 'mismatch') {
          line = `${p.file || p.sfv}: ${p.message} (sfv: ${p.sfv})${p.deleted ? ' [deleted]' : ''}`;
        } else if (p.status === 'unparseable') {
          line = `${p.sfv}: ${p.message}${p.deleted ? ' [deleted]' : ''}`;
        } else {
          line = `${p.file || p.sfv}: ${p.message} (sfv: ${p.sfv})${p.deleted ? ' [deleted]' : ''}`;
        }
        logEvent(socket, line, 'warning');
      }
    } catch (e) {
      sendStatus(socket, type, entityId, `Scan failed: ${e.message}`);
      logEvent(socket, `Scan of "${targetPath}" failed: ${e.message}`, 'error');
      if (cache) {
        await saveCache(cachePath, cache);
      }
    }
  }

  async function handleSfvCheck(socket, extension, settings, scanState, redownloadQueue, type, entityId, args) {
    const rawArgs = (args || []).slice();
    let forceFull = false;
    const fullIndex = rawArgs.findIndex((a) => (a || '').toLowerCase() === 'full');
    if (fullIndex !== -1) {
      forceFull = true;
      rawArgs.splice(fullIndex, 1);
    }

    const givenPath = rawArgs.join(' ').trim();

    if (givenPath.toLowerCase() === 'help') {
      sendStatus(socket, type, entityId, SFV_HELP_TEXT);
      return;
    }

    const defaultDirectory = (settings.getValue('default_directory') || '').trim();
    const rawTargetSpec = givenPath || defaultDirectory;

    if (!rawTargetSpec) {
      sendStatus(
        socket,
        type,
        entityId,
        'Usage: /sfvcheck <folder>[,<folder2>,...] [full], or set a default folder (or comma-separated ' +
        'folders) in the extension settings first so /sfvcheck also works without a path.'
      );
      return;
    }

    const targetPaths = rawTargetSpec.split(',').map((p) => p.trim()).filter(Boolean);

    if (!targetPaths.length) {
      sendStatus(
        socket,
        type,
        entityId,
        'Usage: /sfvcheck <folder>[,<folder2>,...] [full], or set a default folder (or comma-separated ' +
        'folders) in the extension settings first so /sfvcheck also works without a path.'
      );
      return;
    }

    if (scanState.current) {
      sendStatus(
        socket,
        type,
        entityId,
        `A scan of "${scanState.current.targetPath}" is already running. Use /sfvstop to cancel it first.`
      );
      return;
    }

    for (const p of targetPaths) {
      let stat;
      try {
        stat = await fsp.stat(p);
      } catch (e) {
        sendStatus(socket, type, entityId, `Folder not found: ${p}`);
        return;
      }
      if (!stat.isDirectory()) {
        sendStatus(socket, type, entityId, `Folder not found: ${p}`);
        return;
      }
    }

    const concurrency = settings.getValue('concurrency') || 4;
    const useCache = settings.getValue('incremental_cache') !== false;
    const cachePath = extension.configPath + 'sfv-cache.json';
    const cache = useCache ? await loadCache(cachePath) : null;

    const stopFlag = {
      stopped: false
    };
    scanState.current = {
      targetPath: targetPaths[0],
      stopFlag,
      startedAt: Date.now()
    };

    if (targetPaths.length > 1) {
      logEvent(socket, `Scanning ${targetPaths.length} folders in sequence: ${targetPaths.join(', ')}.`, 'info');
    }

    try {
      for (let i = 0; i < targetPaths.length; i++) {
        if (stopFlag.stopped) {
          break;
        }
        const targetPath = targetPaths[i];
        scanState.current.targetPath = targetPath;
        if (targetPaths.length > 1) {
          logEvent(socket, `Folder ${i + 1}/${targetPaths.length}: "${targetPath}".`, 'info');
        }
        await scanOneFolder(
          socket, extension, settings, redownloadQueue, type, entityId,
          targetPath, forceFull, stopFlag, concurrency, useCache, cache, cachePath
        );
      }
    } finally {
      scanState.current = null;
    }
  }

  function handleSfvStop(socket, extension, scanState, type, entityId) {
    if (!scanState.current) {
      sendStatus(socket, type, entityId, 'No active /sfvcheck scan to stop.');
      return;
    }
    const stoppingPath = scanState.current.targetPath;
    scanState.current.stopFlag.stopped = true;
    sendStatus(socket, type, entityId, `Scan of "${stoppingPath}" is stopping (may take a moment until the current file is finished)...`);
    logEvent(socket, `Scan of "${stoppingPath}" manually stopped via /sfvstop.`, 'info');
  }

  const SFV_HELP_TEXT = `
SFV/CRC check commands

/sfvcheck - Check the default folder(s) from the extension settings (if set)
/sfvcheck <path> - Check only that folder (real disk path, not the share name)
/sfvcheck <path1>,<path2>,... - Check several folders one after another (comma-separated)
/sfvcheck <path> full - Same, but ignore the cache and re-hash everything
/sfvstop - Cancel a running scan (including a multi-folder run)

Concurrency, cache on/off, and automatic deletion of CRC mismatches can be set in this extension's Settings tab.`;

  async function handleChatCommand(socket, extension, settings, scanState, redownloadQueue, type, data, entityId) {
    const command = (data.command || '').toLowerCase();
    const args = data.args || [];

    if (command === 'sfvcheck') {
      await handleSfvCheck(socket, extension, settings, scanState, redownloadQueue, type, entityId, args);
    } else if (command === 'sfvstop') {
      handleSfvStop(socket, extension, scanState, type, entityId);
    } else if (command === 'sfvhelp') {
      sendStatus(socket, type, entityId, SFV_HELP_TEXT);
    }
  }

  module.exports = function SfvFolderChecker(socket, extension) {
    let removeHubListener = null;
    let removePrivateChatListener = null;
    const scanState = {
      current: null
    };

    const settings = SettingsManager(socket, {
      extensionName: extension.name,
      configVersion: 1,
      configFile: extension.configPath + 'config.json',
      definitions: SettingDefinitions,
    });

    const redownloadQueue = createRedownloadQueue(socket, settings);

    extension.onStart = async (r) => {
      await settings.load();

      removeHubListener = await socket.addListener('hubs', 'hub_text_command', (data, entityId) =>
        handleChatCommand(socket, extension, settings, scanState, redownloadQueue, 'hubs', data, entityId)
      );
      removePrivateChatListener = await socket.addListener(
        'private_chat',
        'private_chat_text_command',
        (data, entityId) =>
        handleChatCommand(socket, extension, settings, scanState, redownloadQueue, 'private_chat', data, entityId)
      );

      if (r && r.system_info && r.system_info.api_feature_level >= 8) {
        try {
          await registerContextMenuItems(
            socket,
            [{
              id: 'sfvcheck_folder',
              title: 'Check SFV/CRC for this folder',
              icon: {
                semantic: 'yellow search'
              },
              filter: (selectedIds, entityId) => entityId === r.system_info.cid,
              access: 'settings_edit',
              onClick: async (selectedIds, entityId) => {
                for (const itemId of selectedIds) {
                  let item;
                  try {
                    item = await socket.get(`filelists/${entityId}/items/${itemId}`);
                  } catch (e) {
                    continue;
                  }
                  if (!item || item.type.id !== 'directory') continue;

                  let targets = [];
                  try {
                    targets = await resolveRealPaths(socket, item.path || '');
                  } catch (e) {
                    targets = [];
                  }
                  if (targets.length === 0 && item.dupe && item.dupe.paths && item.dupe.paths.length) {
                    // Couldn't resolve one exact subfolder (e.g. a share root

                    targets = item.dupe.paths;
                  }
                  if (targets.length === 0) {
                    logEvent(
                      socket,
                      `Context menu: could not resolve a real disk path for "${item.name}" (virtual path: ${item.path}).`,
                      'warning'
                    );
                    continue;
                  }
                  for (const p of targets) {
                    await handleSfvCheck(
                      socket,
                      extension,
                      settings,
                      scanState,
                      redownloadQueue,
                      'context_menu',
                      null,
                      [p]
                    );
                  }
                }
              },
            }, ],
            'filelist_item', {
              id: extension.name,
              name: extension.name
            }
          );
          logEvent(socket, 'Context menu item "Check SFV/CRC for this folder" registered for Own filelist.', 'info');
        } catch (e) {
          logEvent(socket, `Could not register context menu item: ${e.message}`, 'error');
          console.error(`Could not register context menu item: ${e.message}`);
        }
      } else {
        logEvent(
          socket,
          `Context menu item skipped: api_feature_level is ${r && r.system_info ? r.system_info.api_feature_level : 'unknown'} (needs >= 8).`,
          'warning'
        );
      }

      logEvent(
        socket,
        `${extension.name} started, commands /sfvcheck <folder> [full] and /sfvstop are active.`,
        'info'
      );
    };

    extension.onStop = () => {
      if (scanState.current) scanState.current.stopFlag.stopped = true;
      if (removeHubListener) removeHubListener();
      if (removePrivateChatListener) removePrivateChatListener();
    };
  };

