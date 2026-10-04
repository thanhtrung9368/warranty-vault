#!/usr/bin/env python3
"""Wrap user-visible Vietnamese string literals in `L.t(...)`.

Mechanical, but deliberately conservative: it only touches a literal it can
prove is a plain, non-interpolated, user-facing string, and prints everything it
skipped so the remainder can be handled by hand. Interpolated literals are NEVER
auto-wrapped — `L.t("Còn \\(days) ngày")` would key the catalog on the *template*
while rendering a different string at runtime, so the lookup would always miss
and English would silently never appear.

Usage:
    python3 ios/Tools/wrap_strings.py <file.swift> [--apply]
"""
import re
import sys

VI = re.compile(
    "[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ"
    "ÁÀẢÃẠẤẦẨẪẬẮẰẲẴẶÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ]"
)

# Lines that are never UI copy.
SKIP_LINE = re.compile(
    r"^\s*(//|///|\*)"          # comments
    r"|#Preview"
    r"|^\s*case\s+\w+\s*="      # enum raw values: `case phone = "PHONE"`
    r"|^\s*case\s+\""           # string case labels: `case "PHONE":`
    r"|:\s*$"                   # a label whose body lives on the next lines
)

# A literal that is compared, matched or used as a key rather than shown.
SKIP_CONTEXT = re.compile(
    r"==\s*$|!=\s*$|\.hasPrefix|\.hasSuffix|\.contains\(|\.replacingOccurrences"
    r"|matchKey|\.rawValue|Bundle\.main|ProcessInfo|UserDefaults|systemName:"
)

CALL_OPEN = re.compile(r"\bL\.[tp]\($")


def find_literals(line):
    """Spans of plain double-quoted literals (no interpolation, no triple)."""
    spans = []
    i = 0
    while i < len(line):
        c = line[i]
        if c == "/" and i + 1 < len(line) and line[i + 1] == "/":
            break
        if c == '"':
            if line[i:i + 3] == '"""':
                return []            # multi-line literal: never touch
            start = i
            i += 1
            body = ""
            closed = False
            while i < len(line):
                if line[i] == "\\":
                    body += line[i:i + 2]
                    i += 2
                    continue
                if line[i] == '"':
                    closed = True
                    break
                body += line[i]
                i += 1
            if not closed:
                return []
            spans.append((start, i, body, body))
            i += 1
            continue
        i += 1
    return spans


def already_wrapped(line, start):
    """True when this literal is already the argument of an L.t/L.p call."""
    before = line[:start].rstrip()
    if CALL_OPEN.search(before):
        return True
    # Walk back across a balanced argument list: `L.t("a", x)` etc.
    return "L.t(" in before and before.count("(") > before.count(")")


def wrap_file(path, apply):
    src = open(path, encoding="utf-8").read()
    lines = src.split("\n")
    out = []
    wrapped = 0
    skipped = []

    for lineno, line in enumerate(lines, 1):
        if SKIP_LINE.search(line):
            out.append(line)
            continue
        spans = find_literals(line)
        if not spans:
            out.append(line)
            continue
        hits = []
        for start, end, body, _ in spans:
            if not VI.search(body):
                continue
            if "\\(" in body:
                skipped.append((lineno, "interpolated", body))
                continue
            if already_wrapped(line, start):
                continue
            if SKIP_CONTEXT.search(line[:start]):
                skipped.append((lineno, "compared/keyed", body))
                continue
            # `"KEY": value` — a dictionary key, not a label.
            if re.match(r"^\s*:", line[end:]) and (
                start == 0 or line[start - 1] in "[,{(" or line[:start].strip() == ""
            ):
                skipped.append((lineno, "dictionary key", body))
                continue
            hits.append((start, end + 1, body))
        for start, end, body in reversed(hits):
            line = line[:start] + "L.t(" + line[start:end] + ")" + line[end:]
            wrapped += 1
        out.append(line)

    text = "\n".join(out)
    if wrapped and "import WarrantyVaultKit" not in text and "/Sources/WarrantyVaultKit/" not in path:
        text = text.replace("import SwiftUI\n", "import SwiftUI\nimport WarrantyVaultKit\n", 1)
    if apply and text != src:
        open(path, "w", encoding="utf-8").write(text)

    print(f"{path}: wrapped {wrapped}, skipped {len(skipped)}")
    for lineno, why, body in skipped:
        print(f"   {lineno:4d} [{why}] {body[:110]}")
    return wrapped


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    for path in [a for a in sys.argv[1:] if not a.startswith("--")]:
        wrap_file(path, apply)
