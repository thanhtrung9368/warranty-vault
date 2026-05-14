#!/usr/bin/env bash
# Check that Go HTTP routes registered in cmd/server/main.go + internal/handlers
# match the paths/methods declared in ../openapi.yaml.
#
# Convention: every router registration uses a string literal of the form
#   "METHOD /api/...". This script greps for that pattern and compares against
#   openapi.yaml. CI should fail when the two diverge so the spec, the website
#   client, and the mobile clients stay in lock-step with the Go service.
#
# Requires: bash, grep, sort, diff, python3 (any 3.x; uses only the stdlib).
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
