#!/bin/sh
# Railway mounts the volume as root: hand /data to the node user, then run Kira as node, never as root (L2).
set -e
if [ "$(id -u)" = 0 ]; then
  mkdir -p /data
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
