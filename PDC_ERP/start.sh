#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
HOST=0.0.0.0 PORT=3000 node server.js
