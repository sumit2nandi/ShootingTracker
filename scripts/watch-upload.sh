#!/usr/bin/env bash
# Waits for /home/user/uploads/April.html and copies it into the repo.
for i in $(seq 1 240); do
  if [ -f /home/user/uploads/April.html ]; then
    cp /home/user/uploads/April.html /home/user/ShootingTracker/data/April.html
    echo "CAPTURED April.html at iteration $i"
    exit 0
  fi
  sleep 5
done
echo "TIMEOUT: April.html never appeared"
exit 1
