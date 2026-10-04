#!/usr/bin/env python3
"""Maintain ios/Sources/WarrantyVaultKit/Resources/Localizable.xcstrings.

The .xcstrings file is the single source of truth (Xcode can edit it). This tool
only exists to add entries in bulk without hand-writing JSON, and to report the
conversion status: which `L.t("...")` / `L.p("...")` keys in the Swift sources
are missing from the catalog.

Usage:
    python3 ios/Tools/catalog.py add  <translations.json>
    python3 ios/Tools/catalog.py check
    python3 ios/Tools/catalog.py stats
"""
import json
import os
import re
import sys
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "Sources/WarrantyVaultKit/Resources/Localizable.xcstrings")

CALL = re.compile(r'\bL\.([tp])\(\s*"((?:[^"\\]|\\.)*)"')
# Strings that are the same in both languages on purpose (proper nouns, codes).
VI = re.compile(
    "[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ"
    "ÁÀẢÃẠẤẦẨẪẬẮẰẲẴẶÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ]"
)


def unescape(s):
    return s.replace('\\"', '"').replace("\\\\", "\\").replace("\\n", "\n")


def load():
    if not os.path.exists(CATALOG):
        return {"sourceLanguage": "vi", "strings": {}, "version": "1.0"}
    with open(CATALOG, encoding="utf-8") as f:
        return json.load(f)


def dump(cat):
    cat["strings"] = collections.OrderedDict(sorted(cat["strings"].items()))
    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
        f.write("\n")


def unit(value):
    return {"stringUnit": {"state": "translated", "value": value}}


def make_entry(vi, en):
    """vi: the source text (also the key). en: a string or {'one':..,'other':..}."""
    if isinstance(en, dict):
        return {
            "extractionState": "manual",
            "localizations": {
                "en": {"variations": {"plural": {k: unit(v) for k, v in sorted(en.items())}}},
                "vi": {"variations": {"plural": {"other": unit(vi)}}},
            },
        }
    return {
        "extractionState": "manual",
        "localizations": {"en": unit(en), "vi": unit(vi)},
    }


def cmd_add(path):
    cat = load()
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    added = changed = 0
    for vi, en in payload.items():
        entry = make_entry(vi, en)
        if vi not in cat["strings"]:
            added += 1
        elif cat["strings"][vi] != entry:
            changed += 1
        cat["strings"][vi] = entry
    dump(cat)
    print(f"added {added}, updated {changed}, total {len(cat['strings'])}")


def scan_sources():
    """Every (file, key, plural?) the Swift sources pass to L.t / L.p."""
    hits = []
    for base in ("Sources", "App"):
        for dirpath, _, files in os.walk(os.path.join(ROOT, base)):
            if ".build" in dirpath:
                continue
            for name in sorted(files):
                if not name.endswith(".swift"):
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, ROOT)
                with open(full, encoding="utf-8") as f:
                    for lineno, line in enumerate(f, 1):
                        stripped = line.lstrip()
                        if stripped.startswith("//"):
                            continue
                        for m in CALL.finditer(line):
                            hits.append((rel, lineno, m.group(1), unescape(m.group(2))))
    return hits


def cmd_check():
    cat = load()["strings"]
    hits = scan_sources()
    missing, no_en, no_vi, plural_mismatch = [], [], [], []
    for rel, lineno, kind, key in hits:
        entry = cat.get(key)
        loc = entry["localizations"] if entry else None
        if not loc:
            missing.append(f"{rel}:{lineno} {key!r}")
            continue
        if "en" not in loc:
            no_en.append(f"{rel}:{lineno} {key!r}")
        if "vi" not in loc:
            no_vi.append(f"{rel}:{lineno} {key!r}")
        if kind == "p" and "en" in loc and "variations" not in loc["en"]:
            plural_mismatch.append(f"{rel}:{lineno} {key!r} (L.p but en has no plural forms)")
        if kind == "t" and "en" in loc and "variations" in loc["en"]:
            plural_mismatch.append(f"{rel}:{lineno} {key!r} (L.t but en has plural forms)")
    used = {h[3] for h in hits}
    unused = sorted(set(cat) - used)
    for label, rows in (("MISSING", missing), ("NO-EN", no_en), ("NO-VI", no_vi),
                        ("PLURAL", plural_mismatch)):
        print(f"{label}: {len(rows)}")
        for r in rows[:40]:
            print("   ", r)
    print(f"unused catalog keys: {len(unused)}")
    for u in unused[:40]:
        print("   ", u)
    return 1 if (missing or no_en or no_vi or plural_mismatch) else 0


def cmd_stats():
    cat = load()["strings"]
    hits = scan_sources()
    keys = {h[3] for h in hits}
    print(f"catalog entries : {len(cat)}")
    print(f"L.t/L.p call sites: {len(hits)}  distinct keys: {len(keys)}")
    print(f"keys with no catalog entry: {len(keys - set(cat))}")
    files = collections.Counter(h[0] for h in hits)
    print(f"converted files: {len(files)}")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stats"
    if cmd == "add":
        cmd_add(sys.argv[2])
    elif cmd == "check":
        sys.exit(cmd_check())
    else:
        sys.exit(cmd_stats())
