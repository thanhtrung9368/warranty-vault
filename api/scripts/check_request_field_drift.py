#!/usr/bin/env python3
"""Compare the JSON field set of every strictly-decoded request struct with the
schema openapi.yaml documents for its endpoint.

Why this exists
---------------
`decodeJSON` calls `json.Decoder.DisallowUnknownFields`. A field the schema
promises but the Go struct lacks is therefore a 400 for a client that followed
the docs (the `PATCH /devices/{id}` + `fromWishlistId` bug). The reverse — a
field in the struct but not in the schema — is undocumented functionality that
no client can rely on. Neither shows up in a route-drift check, because the route
is identical either way. This script is the request-shape counterpart to
`check_openapi_drift.sh`.

How it stays honest
-------------------
* It does not keep a separate list of decode sites: it scans every non-test
  handler file for `decodeJSON(r, &x)` and resolves the nearest preceding
  `var x T` declaration. A new strict decoder is therefore a failure until it is
  added to the mapping below, instead of silently going unchecked.
* A destination whose type it cannot resolve is a hard error, not a skip.
* Raw-map decoders (`var raw map[string]json.RawMessage`) cannot be compared to
  a struct. Exactly three are allowlisted by (file, function), because their
  handlers enforce their own key allowlists; any new one fails the check.
* A mapping entry that no strict decoder uses is a hard error, so removals and
  renames cannot leave dead coverage behind.

What it does NOT check
----------------------
Types, nullability, `required`, formats, enums, nested object shapes, or whether
a field is semantically meaningful on the endpoint. Loose decoders
(`decodeJSONLoose`), multipart bodies, response shapes and inline anonymous
request structs are out of scope. Field names are compared exactly; Go's JSON
decoder also matches case-insensitively, which this check deliberately does not
model.

Exit codes: 0 in sync, 1 drift, 2 could not run (missing PyYAML, unparsable
source).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml  # PyYAML — already required by check_openapi_drift.sh
except ImportError:  # pragma: no cover - environment problem, not drift
    sys.stderr.write(
        "check_request_field_drift: PyYAML is required (pip install pyyaml)\n"
    )
    raise SystemExit(2)


# Go struct name -> named schema in openapi.yaml's components.schemas.
# Add a pair here when a new request struct is decoded strictly. The source of
# truth for the endpoint -> schema link is the requestBody `$ref`; this map is
# the bridge to the Go type.
SCHEMA_BY_STRUCT: dict[str, str] = {
    "registerRequest": "RegisterInput",
    "loginRequest": "LoginInput",
    "forgotRequest": "ForgotRequest",
    "changePasswordRequest": "ChangePasswordRequest",
    "resetPasswordRequest": "ResetPasswordRequest",
    "changeEmailRequest": "ChangeEmailRequest",
    "deviceCreateRequest": "DeviceCreateInput",
    "DeviceInput": "DeviceUpdateInput",
    "WarrantyInput": "WarrantyInput",
    "ClaimInput": "ClaimInput",
    "subscriptionRequest": "SubscriptionInput",
    "subscriptionPaymentRequest": "PaymentInput",
    "snoozeRequest": "SnoozeInput",
}

# Strict request bodies whose schema is inline in the path, not a named
# component. The value is (path, method).
INLINE_SCHEMA_BY_STRUCT: dict[str, tuple[str, str]] = {
    "confirmEmailChangeRequest": ("/api/v1/auth/confirm-email-change", "post"),
}

# Strict decoders that decode into a map so their key set lives in handler code.
# Keep this list exact: a new raw-map decode site must be reviewed and added,
# not silently ignored.
RAW_MAP_ALLOWLIST: set[tuple[str, str]] = {
    ("auth.go", "updateMeHandler"),
    ("attachments.go", "updateAttachmentHandler"),
    ("attachments.go", "fileAttachmentHandler"),
}


class CheckError(RuntimeError):
    pass


def strip_comment(line: str) -> str:
    """Drop a // comment that is outside a struct tag (backticks)."""
    out: list[str] = []
    in_tag = False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "`":
            in_tag = not in_tag
        if not in_tag and line.startswith("//", i):
            break
        out.append(ch)
        i += 1
    return "".join(out)


def parse_go_structs(
    roots: list[Path],
) -> tuple[dict[str, dict], set[str]]:
    """Collect raw struct fields without resolving embedded structs.

    Returns ({name: {"fields", "embeds", "unparsed", "origin"}}, ambiguous).
    `unparsed` means the struct contains at least one field the checker cannot
    read (e.g. a field with no JSON tag); that only becomes an error if such a
    struct is actually used as a request type or embedded into one.
    """
    raw: dict[str, dict] = {}
    ambiguous: set[str] = set()

    for root in roots:
        for path in sorted(root.rglob("*.go")):
            if path.name.endswith("_test.go"):
                continue
            text = path.read_text(encoding="utf-8")
            for match in re.finditer(
                r"(?m)^type\s+([A-Za-z_]\w*)\s+struct\s*\{\s*$", text
            ):
                name = match.group(1)
                body_start = text.find("\n", match.start()) + 1
                body_end = text.find("\n}\n", body_start)
                if body_end == -1:
                    raise CheckError(f"{path}: cannot find end of struct {name}")
                if name in raw:
                    # Same name in two packages would make the embed lookup
                    # ambiguous. Only fail if a target actually needs it.
                    ambiguous.add(name)
                    continue
                fields: list[str] = []
                embeds: list[str] = []
                unparsed = False
                for raw_line in text[body_start:body_end].splitlines():
                    line = strip_comment(raw_line).strip()
                    if not line:
                        continue
                    tag = None
                    if "`" in line:
                        head, _, tail = line.partition("`")
                        tag, _, line = tail.partition("`")
                        line = head.strip()
                    parts = line.split()
                    if len(parts) == 1:
                        # Anonymous embedded field, e.g. services.DeviceInput.
                        embeds.append(parts[0].lstrip("*"))
                        continue
                    json_name = None
                    if tag is not None:
                        tm = re.search(r'json:"([^"]*)"', tag)
                        if tm:
                            json_name = tm.group(1).split(",")[0]
                    if not json_name or json_name == "-" or len(parts) < 2:
                        # e.g. Deps.DB: not a request field. Record that this
                        # struct is not exactly comparable; only an error if it
                        # is used as (or embedded into) a checked request type.
                        unparsed = True
                        continue
                    names = parts[0].split(",")
                    if len(names) > 1:
                        raise CheckError(
                            f"{path}:{name}: multi-name field {parts[0]!r} is "
                            f"not supported by this checker"
                        )
                    fields.append(json_name)
                raw[name] = {
                    "fields": fields,
                    "embeds": embeds,
                    "unparsed": unparsed,
                    "origin": str(path),
                }
    return raw, ambiguous


def schema_props(
    doc: dict, schema: dict, seen: frozenset[str] = frozenset()
) -> set[str]:
    """Merge properties through $ref/allOf. Only the key set is used."""
    if not isinstance(schema, dict):
        raise CheckError(f"schema is not an object: {schema!r}")
    props: set[str] = set()
    ref = schema.get("$ref")
    if ref:
        name = ref.rsplit("/", 1)[-1]
        if name in seen:
            raise CheckError(f"$ref cycle at {name}")
        target = doc.get("components", {}).get("schemas", {}).get(name)
        if target is None:
            raise CheckError(f"$ref points at missing schema {name}")
        props |= schema_props(doc, target, seen | {name})
    for sub in schema.get("allOf", []) or []:
        props |= schema_props(doc, sub, seen)
    props |= set((schema.get("properties") or {}).keys())
    return props


def enclosing_func(text: str, offset: int) -> str | None:
    funcs = [
        (m.start(), m.group(1))
        for m in re.finditer(
            r"(?m)^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(", text
        )
    ]
    before = [f for f in funcs if f[0] < offset]
    return max(before, key=lambda f: f[0])[1] if before else None


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write(
            "usage: check_request_field_drift.py <openapi.yaml> <api-dir>\n"
        )
        return 2
    openapi_path = Path(sys.argv[1])
    api_dir = Path(sys.argv[2])
    handler_dir = api_dir / "internal" / "handlers"

    with openapi_path.open(encoding="utf-8") as handle:
        doc = yaml.safe_load(handle) or {}
    schemas = (doc.get("components") or {}).get("schemas") or {}
    paths = doc.get("paths") or {}

    raw_structs, ambiguous = parse_go_structs(
        [handler_dir, api_dir / "internal" / "services"]
    )
    resolved: dict[str, list[str]] = {}

    def fields_of(name: str, stack: tuple[str, ...] = ()) -> list[str]:
        if name in resolved:
            return resolved[name]
        if name in stack:
            raise CheckError(
                "embedded struct cycle: " + " -> ".join((*stack, name))
            )
        if name in ambiguous:
            raise CheckError(
                f"struct {name} is defined in more than one package; the "
                f"checker cannot tell which one the request uses"
            )
        rec = raw_structs.get(name)
        if rec is None:
            raise CheckError(
                f"struct {name} was not found under "
                f"{', '.join(str(r) for r in (handler_dir, api_dir / 'internal' / 'services'))}"
            )
        if rec["unparsed"]:
            raise CheckError(
                f"struct {name} ({rec['origin']}) contains a field without a "
                f"JSON tag, so its wire shape cannot be compared"
            )
        out = list(rec["fields"])
        for embedded in rec["embeds"]:
            base = embedded.rsplit(".", 1)[-1]
            out.extend(fields_of(base, (*stack, name)))
        if len(out) != len(set(out)):
            raise CheckError(f"struct {name} has duplicate JSON field names: {out}")
        resolved[name] = out
        return out

    strict_sites: list[tuple[str, str, str]] = []  # (file, func, struct)
    raw_sites: list[tuple[str, str]] = []  # (file, func)
    for path in sorted(handler_dir.glob("*.go")):
        if path.name.endswith("_test.go"):
            continue
        text = path.read_text(encoding="utf-8")
        declarations = [
            (m.start(), m.group(1), m.group(2))
            for m in re.finditer(
                r"(?m)^\s*var\s+([A-Za-z_]\w*)\s+([^\s=]+)", text
            )
        ]
        # Also accept `x := Type{...}`; the snooze handler uses that form so the
        # default can be set before decoding an optional body.
        declarations.extend(
            (m.start(), m.group(1), m.group(2))
            for m in re.finditer(
                r"(?m)^\s*([A-Za-z_]\w*)\s*:=\s*([A-Za-z_][\w.]*)\{", text
            )
        )
        call_re = re.compile(r"\bdecodeJSON\(\s*r\s*,\s*[^)]+\)")
        var_call_re = re.compile(
            r"\bdecodeJSON\(\s*r\s*,\s*&([A-Za-z_]\w*)\s*\)"
        )
        calls = list(call_re.finditer(text))
        var_calls = list(var_call_re.finditer(text))
        if len(calls) != len(var_calls):
            unresolved = [
                text[: m.start()].count("\n") + 1
                for m in calls
                if m.group(0) not in {v.group(0) for v in var_calls}
            ]
            raise CheckError(
                f"{path.name}: cannot resolve the destination type of every "
                f"decodeJSON call (lines {unresolved}); use `decodeJSON(r, &x)` "
                f"with a named `var x T` so this check can see it"
            )
        for match in var_calls:
            var = match.group(1)
            earlier = [
                d for d in declarations if d[0] < match.start() and d[1] == var
            ]
            if not earlier:
                raise CheckError(
                    f"{path.name}: no `var {var} T` before decodeJSON at line "
                    f"{text[:match.start()].count(chr(10)) + 1}"
                )
            typ = max(earlier, key=lambda d: d[0])[2]
            func = enclosing_func(text, match.start()) or "<unknown>"
            if typ.startswith("map["):
                raw_sites.append((path.name, func))
                continue
            if typ.startswith("struct"):
                raise CheckError(
                    f"{path.name}:{func}: anonymous struct decoded strictly; "
                    f"give it a named type so the checker can compare it"
                )
            base = typ.split(".")[-1].lstrip("*")
            strict_sites.append((path.name, func, base))

    # Every strict decode site must be mapped, and every mapping must be used.
    used_structs = {site[2] for site in strict_sites}
    known_structs = set(SCHEMA_BY_STRUCT) | set(INLINE_SCHEMA_BY_STRUCT)
    unknown = sorted(used_structs - known_structs)
    if unknown:
        raise CheckError(
            "strict decoder(s) not covered by a schema mapping: "
            + ", ".join(unknown)
            + f". Add each to SCHEMA_BY_STRUCT in {Path(__file__).name}."
        )
    unused = sorted(known_structs - used_structs)
    if unused:
        raise CheckError(
            "schema mapping(s) never used by a strict decoder: "
            + ", ".join(unused)
            + f". Remove or correct them in {Path(__file__).name}."
        )

    raw_seen = set(raw_sites)
    extra_raw = sorted(raw_seen - RAW_MAP_ALLOWLIST)
    if extra_raw:
        raise CheckError(
            "raw-map decoder(s) not allowlisted: "
            + ", ".join(f"{f}:{fn}()" for f, fn in extra_raw)
            + ". Either give the body a named struct (so it can be checked) or "
            "add it to RAW_MAP_ALLOWLIST with a reason."
        )
    missing_raw = sorted(RAW_MAP_ALLOWLIST - raw_seen)
    if missing_raw:
        raise CheckError(
            "raw-map allowlist entry never used: "
            + ", ".join(f"{f}:{fn}()" for f, fn in missing_raw)
            + ". Remove it so the allowlist stays a list of real decoders."
        )

    failures: list[str] = []

    def check(label: str, struct_name: str, props: set[str]) -> None:
        field_set = set(fields_of(struct_name))
        missing = sorted(props - field_set)  # schema promises, Go rejects
        extra = sorted(field_set - props)  # Go accepts, schema doesn't promise
        if missing or extra:
            detail = []
            if missing:
                detail.append("in schema but not in struct: " + ", ".join(missing))
            if extra:
                detail.append("in struct but not in schema: " + ", ".join(extra))
            failures.append(f"{label} <-> {struct_name}: " + "; ".join(detail))
            return
        print(f"  OK  {label} <-> {struct_name} ({len(field_set)} fields)")

    checked_structs: set[str] = set()
    for struct_name in sorted(used_structs):
        if struct_name in checked_structs:
            continue
        checked_structs.add(struct_name)
        if struct_name in SCHEMA_BY_STRUCT:
            schema_name = SCHEMA_BY_STRUCT[struct_name]
            schema = schemas.get(schema_name)
            if schema is None:
                raise CheckError(
                    f"schema {schema_name} (mapped from {struct_name}) is missing "
                    f"from openapi.yaml"
                )
            check(schema_name, struct_name, schema_props(doc, schema))
        else:
            path, method = INLINE_SCHEMA_BY_STRUCT[struct_name]
            try:
                schema = paths[path][method]["requestBody"]["content"][
                    "application/json"
                ]["schema"]
            except (KeyError, TypeError):
                raise CheckError(
                    f"inline schema for {struct_name} not found at "
                    f"{method.upper()} {path}"
                ) from None
            check(f"{method.upper()} {path}", struct_name, schema_props(doc, schema))

    if failures:
        sys.stderr.write("Request-shape drift detected:\n")
        for failure in failures:
            sys.stderr.write(f"  - {failure}\n")
        return 1

    print(
        f"OpenAPI <-> Go request fields in sync "
        f"({len(checked_structs)} structs; {len(strict_sites)} strict decode sites, "
        f"{len(raw_sites)} raw-map decoders allowlisted)."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CheckError as err:
        sys.stderr.write(f"check_request_field_drift: {err}\n")
        raise SystemExit(2) from None
