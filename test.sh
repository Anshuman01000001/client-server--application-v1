#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_SCRIPT="$ROOT_DIR/Client/GetMedia.js"
SERVER_SCRIPT="$ROOT_DIR/Server/MediaDB.js"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mtp-tests.XXXXXX")"
RUNTIME_DIR="$TMP_DIR/client-run"
SERVER_LOG="$TMP_DIR/server.log"
SERVER_PID=""
PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "[PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "[FAIL] $1"
  if [[ $# -gt 1 ]]; then
    echo "       $2"
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  pkill -f "node Server/MediaDB" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

reset_runtime_dir() {
  rm -rf "$RUNTIME_DIR"
  mkdir -p "$RUNTIME_DIR"
}

run_client() {
  local log_file="$1"
  shift
  (cd "$RUNTIME_DIR" && node "$CLIENT_SCRIPT" "$@" >"$log_file" 2>&1)
}

start_server() {
  fuser -k 3000/tcp >/dev/null 2>&1 || true
  rm -f "$SERVER_LOG"
  (cd "$ROOT_DIR" && node "$SERVER_SCRIPT" >"$SERVER_LOG" 2>&1) &
  SERVER_PID=$!
  sleep 1

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "Server failed to start"
    [[ -f "$SERVER_LOG" ]] && tail -n 40 "$SERVER_LOG"
    exit 1
  fi
}

check_contains() {
  local file="$1"
  local text="$2"
  grep -qF "$text" "$file"
}

check_secret_text() {
  local file="$1"
  [[ -f "$file" ]] || return 1

  local content
  content="$(tr -d '\r' < "$file" | sed '/^$/d')"

  case "$content" in
    "The ancient password is hidden in the stars above us"|"Knowledge is the key that unlocks every door in life"|"In the depths of silence one discovers true wisdom here")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

test_syntax() {
  local files=(
    "$ROOT_DIR/VigenereCipher.js"
    "$ROOT_DIR/SecretVariants.js"
    "$ROOT_DIR/SecretSessionManager.js"
    "$ROOT_DIR/Server/ClientsHandler.js"
    "$ROOT_DIR/Client/GetMedia.js"
  )

  for file in "${files[@]}"; do
    if ! node -c "$file" >/dev/null 2>&1; then
      fail "Syntax check" "Failed for $file"
      return
    fi
  done
  pass "Syntax check"
}

test_query_found() {
  reset_runtime_dir
  local log="$TMP_DIR/query_found.log"
  run_client "$log" -s 127.0.0.1:3000 -q Swan.jpeg -v 11 || true

  if check_contains "$log" "Response Type: 1 (Found)" && [[ -f "$RUNTIME_DIR/media/downloaded_Swan.jpeg" ]]; then
    pass "Query existing media"
  else
    fail "Query existing media" "Expected found response and downloaded_Swan.jpeg"
    tail -n 20 "$log"
  fi
}

test_query_missing() {
  reset_runtime_dir
  local log="$TMP_DIR/query_missing.log"
  run_client "$log" -s 127.0.0.1:3000 -q DoesNotExist.jpeg -v 11 || true

  if check_contains "$log" "Response Type: 2 (Not Found)" && check_contains "$log" "File not found on server"; then
    pass "Query missing media"
  else
    fail "Query missing media" "Expected not-found response"
    tail -n 20 "$log"
  fi
}

test_version_mismatch() {
  reset_runtime_dir
  local log="$TMP_DIR/version_mismatch.log"
  run_client "$log" -s 127.0.0.1:3000 -q Swan.jpeg -v 10 || true

  if check_contains "$log" "Response Type: 3 (Busy)" && check_contains "$log" "Server is busy or version mismatch"; then
    pass "Version mismatch handling"
  else
    fail "Version mismatch handling" "Expected busy response for version 10"
    tail -n 20 "$log"
  fi
}

test_secret_success() {
  reset_runtime_dir
  local log="$TMP_DIR/secret_success.log"
  run_client "$log" -s 127.0.0.1:3000 -v 11 --type secret || true

  if check_contains "$log" "=== DECRYPTED SECRET ===" \
    && check_contains "$log" "Sending Complete request (type 4)" \
    && check_contains "$log" "Sending ACK for key part 0" \
    && check_contains "$log" "Sending ACK for key part 1" \
    && check_contains "$log" "Sending ACK for key part 2" \
    && check_secret_text "$RUNTIME_DIR/media/secret_message.txt"; then
    pass "Secret session happy path"
  else
    fail "Secret session happy path" "Expected full decrypt flow and saved secret_message.txt"
    tail -n 40 "$log"
  fi
}

test_secret_failure_reset() {
  reset_runtime_dir
  local log="$TMP_DIR/secret_failure_reset.log"
  run_client "$log" -s 127.0.0.1:3000 -v 10 --type secret || true

  if check_contains "$log" "Secret session failed:" && check_contains "$log" "Sending Reset request (type 5)"; then
    pass "Reset issued on secret failure"
  else
    fail "Reset issued on secret failure" "Expected client to send Reset after secret-mode failure"
    tail -n 30 "$log"
  fi
}

test_wrong_ack_rejected() {
  local log="$TMP_DIR/wrong_ack.log"

  node >"$log" 2>&1 <<'NODE'
const net = require('net');

function storeBitPacket(packet, value, offset, length) {
  let lastBitPosition = offset + length - 1;
  let number = value.toString(2);
  number = number.length > length ? number.slice(number.length - length) : number.padStart(length, '0');
  let j = number.length - 1;
  for (let i = 0; i < number.length; i++) {
    let bytePosition = Math.floor(lastBitPosition / 8);
    let bitPosition = 7 - (lastBitPosition % 8);
    if (number.charAt(j--) === '0') packet[bytePosition] &= ~(1 << bitPosition);
    else packet[bytePosition] |= 1 << bitPosition;
    lastBitPosition--;
  }
}

function parseBitPacket(packet, offset, length) {
  let number = '';
  for (let i = 0; i < length; i++) {
    let bytePosition = Math.floor((offset + i) / 8);
    let bitPosition = 7 - ((offset + i) % 8);
    let bit = (packet[bytePosition] >> bitPosition) % 2;
    number = (number << 1) | bit;
  }
  return number;
}

function createReq(type, name, version = 11) {
  const b = Buffer.from(name);
  const p = Buffer.alloc(12 + b.length);
  p.fill(0);
  storeBitPacket(p, version, 0, 5);
  storeBitPacket(p, 0, 5, 24);
  storeBitPacket(p, type, 29, 3);
  storeBitPacket(p, Date.now(), 32, 32);
  storeBitPacket(p, 0, 64, 4);
  storeBitPacket(p, b.length, 68, 28);
  b.copy(p, 12);
  return p;
}

function parseRiddleSequence(riddle) {
  const out = [];
  for (const s of riddle.split('.').map(x => x.trim()).filter(Boolean)) {
    const lower = s.toLowerCase();
    let file = null;
    if (lower.includes('rose') || lower.includes('flower') || lower.includes('love') || lower.includes('romance') || lower.includes('bloom') || lower.includes('thorny')) file = 'Rose';
    else if (lower.includes('dog') || lower.includes('best friend') || lower.includes("man's best")) file = 'Dog';
    else if (lower.includes('swan') || lower.includes('elegant bird') || lower.includes('graceful bird') || lower.includes('lake') || lower.includes('grace')) file = 'Swan';
    else if (lower.includes('bunny') || lower.includes('hopper') || lower.includes('hopping') || lower.includes('furry') || lower.includes('rabbit')) file = 'bunny';
    if (file && !out.includes(file)) out.push(file);
  }
  return out;
}

const sock = new net.Socket();
let buf = Buffer.alloc(0);
let sentWrongAck = false;
let done = false;

function finish(code) {
  if (done) return;
  done = true;
  if (!sock.destroyed) sock.destroy();
  setTimeout(() => process.exit(code), 100);
}

sock.connect(3000, '127.0.0.1', () => {
  sock.write(createReq(2, 'secret'));
});

sock.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 12) {
    const h = buf.slice(0, 12);
    const payloadSize = parseBitPacket(h, 65, 31);
    if (buf.length < 12 + payloadSize) break;

    const payload = buf.slice(12, 12 + payloadSize);
    buf = buf.slice(12 + payloadSize);

    const responseType = parseBitPacket(h, 5, 3);
    if (responseType !== 4) continue;

    const flag = parseBitPacket(h, 32, 3);
    const partIndex = parseBitPacket(h, 35, 2);
    const text = payload.toString();

    if (flag === 1) {
      const seq = parseRiddleSequence(text);
      sock.write(createReq(1, seq[0]));
    } else if (flag === 2 && !sentWrongAck) {
      sentWrongAck = true;
      const wrong = (partIndex + 1) % 3;
      sock.write(createReq(3, String(wrong)));
    } else if (flag === 5) {
      console.log(text);
      finish(0);
      return;
    }
  }
});

sock.on('error', (err) => {
  console.log(err.message);
  finish(1);
});

setTimeout(() => {
  console.log('Timed out waiting for invalid-ACK rejection');
  finish(1);
}, 25000);
NODE

  if [[ $? -eq 0 ]] && grep -Eq "Incorrect ACK index|Invalid ACK|restart" "$log"; then
    pass "Invalid ACK rejection"
  else
    fail "Invalid ACK rejection" "Expected server to reject wrong ACK index"
    tail -n 20 "$log"
  fi
}

echo "Running tests from: $ROOT_DIR"
echo "Temporary files: $TMP_DIR"

test_syntax
start_server
test_query_found
test_query_missing
test_version_mismatch
test_secret_success
test_secret_failure_reset
test_wrong_ack_rejected

echo
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "All tests passed."
  exit 0
else
  echo "Some tests failed."
  exit 1
fi
