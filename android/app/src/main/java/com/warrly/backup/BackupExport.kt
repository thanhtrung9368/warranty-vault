package com.warrly.backup

import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * MIME type of the full backup: `GET /api/v1/backup/export?includeBlobs=true`
 * streams a ZIP, not the metadata-only JSON the bare path returns.
 */
const val BACKUP_MIME: String = "application/zip"

/**
 * Cache sub-directory the ZIP is written to before sharing. It is declared as a
 * `cache-path` in `res/xml/file_paths.xml`, so the existing
 * `androidx.core.content.FileProvider` can hand out a URI for it.
 */
const val BACKUP_CACHE_DIR: String = "backup"

/**
 * File name of the downloaded backup, e.g. `warrly-backup-2026-11-28.zip`.
 *
 * ASCII and date-only on purpose: the file travels through mail, Drive and chat
 * apps, and a date that sorts lexicographically is the one useful piece of
 * information when several backups sit in the same folder. [date] is
 * injectable so the name is deterministic under test.
 */
fun backupFileName(date: LocalDate = LocalDate.now()): String =
    "warrly-backup-${date.format(DateTimeFormatter.ISO_LOCAL_DATE)}.zip"
