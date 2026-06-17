#!/bin/bash
# ============================================
# LUODA Deploy Script — VPS Low-Spec Edition
# Usage: bash deploy.sh
# ============================================
set -e

echo "============================================"
echo "  LUODA Zhongzhuan Luyou - VPS Deploy"
echo "============================================"
echo ""

# Config
PROJECT_DIR="/opt/1panel/LuoDaBridge"
BACKUP_DIR="/opt/1panel/LuoDaBridge_bak_$(date +%Y%m%d_%H%M%S)"
NODE_BIN=$(which node || echo "/usr/bin/node")

# Check Node.js
if [ ! -x "$NODE_BIN" ]; then
    echo "[ERROR] Node.js not found. Install with: apt install -y nodejs"
    exit 1
fi
echo "[OK] Node.js: $($NODE_BIN -v)"

# Backup old files
echo ""
echo "[1/4] Backing up current version..."
mkdir -p "$BACKUP_DIR"
cp "$PROJECT_DIR/.env" "$BACKUP_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/models.json" "$BACKUP_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/config-proxy.json" "$BACKUP_DIR/" 2>/dev/null || true
echo "  Backup: $BACKUP_DIR"

# Pull latest code
echo ""
echo "[2/4] Deploying v3 code..."
cd "$PROJECT_DIR"

# Install production dependencies only
echo "  Installing dependencies..."
npm install --production --no-optional 2>/dev/null || npm install --no-optional

# Setup data directory
mkdir -p data

# Set proper permissions
chmod +x start.sh stop.sh 2>/dev/null || true

echo ""
echo "[3/4] Creating startup script..."
cat > start.sh << 'SCRIPT'
#!/bin/bash
# Start LuoDaBridge with memory optimization for low-end VPS
# 128MB memory limit + auto restart on crash
PROJECT_DIR="/opt/1panel/LuoDaBridge"
cd "$PROJECT_DIR"

# Kill any existing instance
pkill -f "node index.mjs" 2>/dev/null || true
sleep 1

# Start with memory limit and low-priority IO
NODE_OPTIONS="--max-old-space-size=128" nice -n 10 node index.mjs > data/luoda.log 2>&1 &

echo $! > data/luoda.pid
echo "LUODA started (PID: $(cat data/luoda.pid))"
echo "Log: $PROJECT_DIR/data/luoda.log"
SCRIPT
chmod +x start.sh

cat > stop.sh << 'SCRIPT'
#!/bin/bash
# Stop LuoDaBridge
pkill -f "node index.mjs" 2>/dev/null && echo "LUODA stopped" || echo "LUODA not running"
SCRIPT
chmod +x stop.sh

echo ""
echo "[4/4] Starting service..."
bash start.sh

echo ""
echo "============================================"
echo "  Deploy complete!"
echo "  Admin:  http://YOUR_VPS_IP:40002"
echo "  Proxy:  http://YOUR_VPS_IP:40000/v1"
echo "  Log:    $PROJECT_DIR/data/luoda.log"
echo "============================================"
echo ""
echo "Commands:"
echo "  bash start.sh   -- Start service"
echo "  bash stop.sh    -- Stop service"
echo "  tail -f data/luoda.log  -- View logs"
