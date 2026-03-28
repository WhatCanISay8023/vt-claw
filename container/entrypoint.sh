#!/bin/bash

# Secrets are passed via stdin JSON — temp file is deleted immediately after Node reads it
# Follow-up messages arrive via IPC files in /workspace/ipc/input/

set -e
cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist

cat > /tmp/input.json
cd /workspace/group
node /tmp/dist/index.js < /tmp/input.json
