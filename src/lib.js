'use strict';

"use strict";

  const fs = require('fs');
  const fsp = fs.promises;
  const path = require('path');
  const zlib = require('zlib');

  const HAS_NATIVE_CRC32 = typeof zlib.crc32 === 'function';

  const CRC_TABLE = HAS_NATIVE_CRC32 ? null : (() => {
    const table = new Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  const READ_HIGH_WATER_MARK = 1024 * 1024;

  function crc32OfFile(filePath) {
    return new Promise((resolve, reject) => {
      let crc = HAS_NATIVE_CRC32 ? 0 : (0 ^ -1);
      const stream = fs.createReadStream(filePath, {
        highWaterMark: READ_HIGH_WATER_MARK
      });
      stream.on('data', (chunk) => {
        if (HAS_NATIVE_CRC32) {
          crc = zlib.crc32(chunk, crc);
        } else {
          for (let i = 0; i < chunk.length; i++) {
            crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ chunk[i]) & 0xff];
          }
        }
      });
      stream.on('end', () => resolve(HAS_NATIVE_CRC32 ? (crc >>> 0) : ((crc ^ -1) >>> 0)));
      stream.on('error', reject);
    });
  }

  async function crc32Hex(filePath) {
    const value = await crc32OfFile(filePath);
    return value.toString(16).toUpperCase().padStart(8, '0');
  }

  async function readTextWithBom(filePath) {
    const raw = await fsp.readFile(filePath);
    if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
      return raw.slice(3).toString('utf8');
    }
    if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
      return raw.slice(2).toString('utf16le');
    }
    return raw.toString('utf8');
  }

  async function parseSfvFile(sfvPath) {
    const text = await readTextWithBom(sfvPath);
    const entries = [];
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';')) continue;
      const match = line.match(/^(.*\S)\s+([0-9a-fA-F]{8})$/);
      if (!match) continue;
      entries.push({
        file: match[1].trim(),
        crc: match[2].toUpperCase()
      });
    }
    return entries;
  }

  async function findSfvFiles(rootDir) {
    const results = [];
    async function walk(dir) {
      let items;
      try {
        items = await fsp.readdir(dir, {
          withFileTypes: true
        });
      } catch (e) {
        return;
      }
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walk(full);
        } else if (item.isFile() && item.name.toLowerCase().endsWith('.sfv')) {
          results.push(full);
        }
      }
    }
    await walk(rootDir);
    return results;
  }

  async function runPool(items, concurrency, worker, stopFlag) {
    const size = Math.max(1, concurrency | 0);
    let nextIndex = 0;

    async function runNext() {
      while (nextIndex < items.length) {
        if (stopFlag && stopFlag.stopped) return;
        const i = nextIndex++;
        await worker(items[i], i);
      }
    }

    const workers = Array.from({
      length: Math.min(size, items.length) || 1
    }, runNext);
    await Promise.all(workers);
  }

  const STAT_HASH_RETRY_ATTEMPTS = 3;
  const STAT_HASH_RETRY_DELAY_MS = 300;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function withRetry(fn, attempts, delayMs) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        if (i < attempts - 1) {
          await delay(delayMs);
        }
      }
    }
    throw lastError;
  }

    async function hashOneItem(item, results, onProgress, processed, total, cache, forceFull) {
    let status;
    let foundCrc = null;
    let message = null;
    let fromCache = false;

    let stat;
    try {
      stat = await withRetry(() => fsp.stat(item.file), STAT_HASH_RETRY_ATTEMPTS, STAT_HASH_RETRY_DELAY_MS);
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
        status = 'missing';
        message = 'File is missing from disk';
        if (cache) cache.delete(item.file);
      } else {
        status = 'error';
        message = `Could not read file: ${e.message}`;
      }
      results.push({
        sfv: item.sfv,
        file: item.file,
        expectedCrc: item.expectedCrc,
        foundCrc: null,
        status,
        message,
        fromCache: false
      });
      processed.count++;
      if (onProgress) {
        try {
          onProgress(processed.count, total, item, false);
        } catch (e) {

        }
      }
      return;
    }

    const cached = cache ? cache.get(item.file) : null;
    const cacheValid = !forceFull &&
      cached &&
      cached.size === stat.size &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.expectedCrc === item.expectedCrc &&
      (cached.status === 'ok' || cached.status === 'mismatch');

    if (cacheValid) {
      foundCrc = cached.foundCrc;
      status = cached.status;
      message =
        status === 'mismatch' ?
        `CRC does not match (expected ${item.expectedCrc}, found ${foundCrc}) [unchanged since previous scan]` :
        null;
      fromCache = true;

      cached.checkedAt = Date.now();
    } else {
      try {
        foundCrc = await withRetry(() => crc32Hex(item.file), STAT_HASH_RETRY_ATTEMPTS, STAT_HASH_RETRY_DELAY_MS);
        if (foundCrc === item.expectedCrc) {
          status = 'ok';
        } else {
          status = 'mismatch';
          message = `CRC does not match (expected ${item.expectedCrc}, found ${foundCrc})`;
        }
      } catch (e) {
        if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
          status = 'missing';
          message = 'File is missing from disk';
        } else {
          status = 'error';
          message = `Could not calculate CRC: ${e.message}`;
        }
      }

      if (cache) {
        if (status === 'ok' || status === 'mismatch') {
          cache.set(item.file, {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            expectedCrc: item.expectedCrc,
            status,
            foundCrc,
            checkedAt: Date.now(),
          });
        } else {
          cache.delete(item.file);
        }
      }
    }

    results.push({
      sfv: item.sfv,
      file: item.file,
      expectedCrc: item.expectedCrc,
      foundCrc,
      status,
      message,
      fromCache,
    });

    processed.count++;
    if (onProgress) {
      try {
        onProgress(processed.count, total, item, fromCache);
      } catch (e) {

      }
    }
  }

  async function scanFolder(rootDir, options = {}) {
    const concurrency = options.concurrency && options.concurrency > 0 ? options.concurrency : 4;
    const onProgress = options.onProgress;
    const cache = options.cache || null;
    const forceFull = !!options.forceFull;
    const stopFlag = options.stopFlag || null;

    const sfvFiles = await findSfvFiles(rootDir);

    const groups = [];
    const results = [];
    let total = 0;

    for (const sfvPath of sfvFiles) {
      const dir = path.dirname(sfvPath);
      let entries;
      try {
        entries = await parseSfvFile(sfvPath);
      } catch (e) {
        results.push({
          sfv: sfvPath,
          file: null,
          expectedCrc: null,
          foundCrc: null,
          status: 'error',
          message: `Could not read sfv file: ${e.message}`,
        });
        continue;
      }

      if (entries.length === 0) {
        // Readable, but nothing usable came out of it (empty, comments-only,
        // or every line failed to match the "filename CRC32" format) --
        // previously this just silently vanished from the report instead of
        // being flagged as a problem.
        results.push({
          sfv: sfvPath,
          file: null,
          expectedCrc: null,
          foundCrc: null,
          status: 'unparseable',
          message: 'No valid lines could be parsed from this SFV file (empty, comments-only, or malformed)',
        });
        continue;
      }

      const items = entries.map((entry) => ({
        sfv: sfvPath,
        file: path.join(dir, entry.file),
        expectedCrc: entry.crc,
      }));
      total += items.length;
      groups.push(items);
    }

    const processed = {
      count: 0
    };

    await runPool(
      groups,
      concurrency,
      async (items) => {

          for (const item of items) {
            if (stopFlag && stopFlag.stopped) break;
            await hashOneItem(item, results, onProgress, processed, total, cache, forceFull);
          }
        },
        stopFlag
    );

    return {
      sfvFiles,
      results,
      stopped: !!(stopFlag && stopFlag.stopped)
    };
  }

  function pruneCache(cache, maxAgeMs) {
    if (!cache || !maxAgeMs || maxAgeMs <= 0) return 0;
    const now = Date.now();
    let removed = 0;
    for (const [file, entry] of cache.entries()) {
      if (!entry || typeof entry.checkedAt !== 'number' || now - entry.checkedAt > maxAgeMs) {
        cache.delete(file);
        removed++;
      }
    }
    return removed;
  }

  function pruneReports(reportDir, maxAgeMs) {
    if (!maxAgeMs || maxAgeMs <= 0) return 0;
    let entries;
    try {
      entries = fs.readdirSync(reportDir);
    } catch (e) {
      return 0;
    }
    const now = Date.now();
    let removed = 0;
    for (const name of entries) {
      if (!name.startsWith('sfvcheck_') || !name.endsWith('.json')) continue;
      const full = path.join(reportDir, name);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch (e) {

      }
    }
    return removed;
  }

  function writeReport(rootDir, results, reportDir) {
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, {
        recursive: true
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName =
      path
      .basename(rootDir)
      .replace(/[^a-z0-9_\-. ]/gi, '_')
      .slice(0, 80) || 'root';
    const reportPath = path.join(reportDir, `sfvcheck_${safeName}_${timestamp}.json`);

    const payload = {
      scanned_path: rootDir,
      scanned_at: new Date().toISOString(),
      total_checked: results.length,
      problems: results.filter((r) => r.status !== 'ok'),
      results,
    };

    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
    return reportPath;
  }

  module.exports = {
    crc32OfFile,
    crc32Hex,
    parseSfvFile,
    findSfvFiles,
    scanFolder,
    writeReport,
    pruneCache,
    pruneReports,
    HAS_NATIVE_CRC32,
  };

