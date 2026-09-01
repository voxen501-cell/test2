#!/usr/bin/env bash
set -e

DOMAIN="${DOMAIN:-$(hostname -f)}"
APP_DIR=/opt/aibridge
PORT="${PORT:-443}"

echo
echo "=============================================="
echo " AI Companion bridge setup"
echo " domain : $DOMAIN"
echo " port   : $PORT"
echo "=============================================="
echo

echo "[1/6] installing node, git and certbot"
apt-get update -qq
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs git certbot >/dev/null
echo "      node $(node --version)"

echo "[2/6] getting a TLS certificate for $DOMAIN"
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "      certificate already present, keeping it"
else
  systemctl stop aibridge 2>/dev/null || true
  fuser -k 80/tcp 2>/dev/null || true
  certbot certonly --standalone --non-interactive --agree-tos \
    --register-unsafely-without-email -d "$DOMAIN"
fi
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
if [ ! -f "$CERT" ]; then
  echo "      FAILED: no certificate at $CERT"
  exit 1
fi
echo "      certificate ready"

echo "[3/6] downloading the bridge"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin main
  git -C "$APP_DIR" reset --hard --quiet origin/main
else
  rm -rf "$APP_DIR"
  git clone --quiet https://github.com/voxen501-cell/test2.git "$APP_DIR"
fi
cd "$APP_DIR"
npm install --silent --no-audit --no-fund
echo "      code ready"

echo "[4/6] writing config"
OLD_KEY=""
if [ -f "$APP_DIR/config.json" ]; then
  OLD_KEY=$(node -e "try{console.log(require('$APP_DIR/config.json').apiKey||'')}catch(e){console.log('')}")
fi
KEY_VALUE="${AI_API_KEY:-$OLD_KEY}"
node -e "
const fs=require('fs');
const cfg={
  provider:'groq',
  apiKey:process.argv[1]||'',
  model:'',
  maxTokens:600,
  reasoningEffort:'low',
  port:Number(process.argv[2]),
  trigger:'ai',
  output:'addon',
  historyTurns:8,
  cooldownMs:1500,
  maxPerMinute:15,
  chunkSize:700,
  chunkDelayMs:120,
  encryption:'auto',
  encryptionWaitMs:2500,
  postHandshakeMs:500,
  subscribeGapMs:80,
  tlsCertPath:process.argv[3],
  tlsKeyPath:process.argv[4],
  useGameContext:true,
  allowActions:true,
  defaultAlwaysOn:true,
  actionsAllowed:[],
  maxActions:20,
  actionGapMs:150,
  gameRoot:'',
  systemPrompt:'You are a helpful companion living inside a Minecraft world with the player. Answer in plain text, no markdown, no lists, no asterisks. Keep every answer under 60 words unless the player asks for more. Always reply using only Latin letters and ordinary keyboard characters, never Devanagari or any other script, because the game font cannot draw them. If the player writes Hindi using Latin letters, reply the same way in Latin letters. You can see some things about the world and not others, so answer from what you are given and say clearly when something is not visible to you.'
};
fs.writeFileSync('$APP_DIR/config.json',JSON.stringify(cfg,null,2));
" "$KEY_VALUE" "$PORT" "$CERT" "$KEY"
echo "      config written"

echo "[5/6] installing the service"
cat > /etc/systemd/system/aibridge.service <<UNIT
[Unit]
Description=AI Companion bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --quiet aibridge
systemctl restart aibridge
sleep 3
echo "      service installed"

echo "[6/6] status"
echo
systemctl is-active --quiet aibridge && echo "  RUNNING" || echo "  NOT RUNNING"
journalctl -u aibridge -n 12 --no-pager | sed 's/^/  /'
echo
if [ -z "$KEY_VALUE" ]; then
  echo "=============================================="
  echo " No API key yet. Put yours in with:"
  echo "   nano $APP_DIR/config.json"
  echo " then:  systemctl restart aibridge"
  echo "=============================================="
else
  echo "=============================================="
  echo " Ready. In Minecraft run:"
  echo "   /connect $DOMAIN:$PORT"
  echo
  echo " Watch the log with:"
  echo "   journalctl -u aibridge -f"
  echo "=============================================="
fi
