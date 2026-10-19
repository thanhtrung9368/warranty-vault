#!/usr/bin/env bash
# Check two things against ../openapi.yaml:
#   1. the Go HTTP routes registered in cmd/server/main.go + internal/handlers
#      match the paths/methods the spec declares, and
#   2. each strictly-decoded request struct's JSON field set matches the schema
#      its endpoint documents (see check_request_field_drift.py).
#
# Convention: every router registration uses a string literal of the form
#   "METHOD /api/...". This script greps for that pattern and compares against
#   openapi.yaml. CI should fail when the two diverge so the spec, the website
#   client, and the mobile clients stay in lock-step with the Go service.
#
# Requires: bash, grep, sort, diff, python3 + PyYAML (the latter is already
# required by the request-field pass).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${API_DIR}/.." && pwd)"
OPENAPI="${REPO_ROOT}/openapi.yaml"

GO_ROUTES="$(mktemp)"
OPENAPI_ROUTES="$(mktemp)"
trap 'rm -f "${GO_ROUTES}" "${OPENAPI_ROUTES}"' EXIT

# Extract Go routes (METHOD /path pairs).
grep -hroE '"[A-Z]+ /api/[^"]+"' \
    "${API_DIR}/cmd/server/main.go" \
    "${API_DIR}/internal/handlers/" \
  | tr -d '"' \
  | sort -u > "${GO_ROUTES}"

# Extract openapi paths × methods using Python (stdlib only, no yq dependency).
python3 - "${OPENAPI}" > "${OPENAPI_ROUTES}" <<'PY'
import sys
try:
    import yaml  # PyYAML — usually present on dev boxes and CI runners.
except ImportError:
    # Fallback: try the bundled-with-Ansible path, then bail with a clear msg.
    sys.stderr.write(
        "check_openapi_drift: PyYAML is required (pip install pyyaml)\n"
    )
    sys.exit(2)

with open(sys.argv[1], "r", encoding="utf-8") as f:
    doc = yaml.safe_load(f)

paths = (doc or {}).get("paths", {}) or {}
methods = {"get", "post", "put", "patch", "delete"}
out = set()
for p, body in paths.items():
    if not isinstance(body, dict):
        continue
    for m in body.keys():
        if m.lower() in methods:
            out.add(f"{m.upper()} {p}")

for line in sorted(out):
    print(line)
PY

if ! diff -u "${OPENAPI_ROUTES}" "${GO_ROUTES}"; then
    echo
    echo "OpenAPI drift detected."
    echo "  '-' lines are in openapi.yaml but missing from the Go server."
    echo "  '+' lines are registered in Go but missing from openapi.yaml."
    echo "Reconcile both sides before merging."
    exit 1
fi

echo "OpenAPI ↔ Go routes in sync ($(wc -l < "${GO_ROUTES}" | tr -d ' ') endpoints)."

# Routes can match while the request bodies do not. `decodeJSON` uses
# DisallowUnknownFields, so a schema field missing from its Go struct is a 400
# for a client that followed the docs; the reverse is undocumented functionality.
# The sibling script resolves every strict `decodeJSON(r, &x)` call in
# internal/handlers and compares the struct's json tags with the schema its
# endpoint documents. It fails loudly on a decode site it cannot map, so this is
# not a hand-picked sample that can silently stop covering endpoints.
echo
set +e
python3 "${SCRIPT_DIR}/check_request_field_drift.py" "${OPENAPI}" "${API_DIR}"
field_rc=$?
set -e
if [ "${field_rc}" -eq 1 ]; then
    echo
    echo "OpenAPI request-field drift detected."
    echo "Reconcile the Go request struct and the schema for each pair above."
    exit 1
elif [ "${field_rc}" -ne 0 ]; then
    echo
    echo "OpenAPI request-field check could not run (exit ${field_rc}); fix the"
    echo "environment or the checker instead of treating this as a pass."
    exit "${field_rc}"
fi
