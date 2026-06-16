#!/bin/bash

# --- Configuration ---
LOCAL_DIR="./packages"
REMOTE_USER="root"
REMOTE_HOST="127.0.0.1"
REMOTE_PATH="/home/npm"
SSH_KEY="./npmreg.pem"
SSH_PORT="22"
PASSWORD=""  # Leave empty to use SSH key authentication

# --- Retry & Log Configuration ---
MAX_RETRIES=5
RETRY_DELAY=30
LOG_FILE="./upload_$(basename $LOCAL_DIR)_$(date +%Y%m%d_%H%M%S).log"

# Redirect ALL output to log file
exec > >(tee -a "$LOG_FILE") 2>&1

# --- Password handling ---
# If password is set, use sshpass
if [ -n "$PASSWORD" ]; then
    # Check if sshpass is installed
    if ! command -v sshpass &> /dev/null; then
        echo "ERROR: sshpass is not installed. Please install it first:"
        echo "  Ubuntu/Debian: sudo apt-get install sshpass"
        echo "  CentOS/RHEL: sudo yum install sshpass"
        echo "  macOS: brew install hudochenkov/sshpass/sshpass"
        exit 1
    fi
    SSH_PREFIX="sshpass -p '$PASSWORD'"
else
    SSH_PREFIX=""
fi

# Build SCP command
SCP_CMD="$SSH_PREFIX scp -v -r -P $SSH_PORT -i '$SSH_KEY' -o ServerAliveInterval=60 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null '$LOCAL_DIR' $REMOTE_USER@$REMOTE_HOST:'$REMOTE_PATH'"

echo "================================"
echo "Starting upload of folder: $LOCAL_DIR"
echo "Destination: $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
echo "Authentication: $([ -n "$PASSWORD" ] && echo "Password" || echo "SSH Key")"
echo "Start time: $(date)"
echo "Max retries: $MAX_RETRIES"
echo "Log file: $LOG_FILE"
echo "================================"

RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo ""
    echo "$(date) - Starting attempt #$(($RETRY_COUNT + 1))..."
    
    if eval $SCP_CMD; then
        echo ""
        echo "================================"
        echo "$(date) - Upload completed successfully!"
        echo "All output saved to: $LOG_FILE"
        echo "================================"
        exit 0
    else
        RETRY_COUNT=$((RETRY_COUNT+1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "$(date) - Upload failed. $(($MAX_RETRIES - $RETRY_COUNT)) attempts remaining."
            echo "Waiting $RETRY_DELAY seconds before retry..."
            sleep $RETRY_DELAY
        else
            echo ""
            echo "================================"
            echo "$(date) - ERROR: Upload failed after $MAX_RETRIES attempts."
            echo "Check log: $LOG_FILE"
            echo "================================"
            exit 1
        fi
    fi
done
