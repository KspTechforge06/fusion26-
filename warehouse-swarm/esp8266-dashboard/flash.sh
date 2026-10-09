#!/usr/bin/env bash
# Flash the OLED dashboard node.
#   ./flash.sh            # auto-detect the serial port
#   ./flash.sh /dev/ttyUSB0
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-}"
if [ -z "$PORT" ]; then
  for p in /dev/ttyUSB* /dev/ttyACM*; do
    [ -e "$p" ] && PORT="$p" && break
  done
fi
if [ -z "$PORT" ]; then
  echo "No serial port found. Plug in the NodeMCU and retry, or pass the port explicitly:" >&2
  echo "  ./flash.sh /dev/ttyUSB0" >&2
  exit 1
fi

echo "Uploading dashboard firmware to $PORT ..."
arduino-cli upload -p "$PORT" --fqbn esp8266:esp8266:nodemcuv2 "$PWD"
echo
echo "Done. Verify with a serial monitor at 115200 baud:"
echo "  screen $PORT 115200"
echo '  (try: help / page 5 / web)'