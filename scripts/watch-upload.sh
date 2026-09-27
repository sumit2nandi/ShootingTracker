#!/usr/bin/env bash
# Waits for the user's data file in /home/user/uploads and copies it into the repo.
for i in $(seq 1 300); do
  if [ -d /home/user/uploads ]; then
    for f in /home/user/uploads/*; do
      [ -f "$f" ] || continue
      base="$(basename "$f")"
      # normalize spaces in the stored name
      out="/home/user/ShootingTracker/data/upload-$(echo "$base" | tr ' ' '_')"
      if [ ! -f "$out" ]; then
        cp "$f" "$out"
        echo "CAPTURED: $base -> $out (iteration $i)"
      fi
    done
    # stop once any data file is captured
    ls /home/user/ShootingTracker/data/upload-* >/dev/null 2>&1 && exit 0
  fi
  sleep 5
done
echo "TIMEOUT: no upload captured"
exit 1
