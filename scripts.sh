#!/bin/bash

CONFIG_FILE="$HOME/.deploy_config"
REMOTE_BASE="/home/npm-mirror/packages"

check_dependencies() {
    for cmd in ssh scp sshpass; do
        if ! command -v $cmd &> /dev/null; then
            echo "$cmd is not installed."
            exit 1
        fi
    done
}

add_server() {
    echo "=== Add new server ==="
    read -p "Server (user@ip): " SERVER
    read -p "SSH port (default 22): " PORT
    PORT=${PORT:-22}

    read -p "Use SSH key? (y/n): " USE_KEY

    if [[ "$USE_KEY" =~ ^[Yy]$ ]]; then
        AUTH="key"
        read -p "SSH key path: " SSH_KEY
        PASSWORD=""
    else
        AUTH="password"
        read -s -p "Password: " PASSWORD
        echo
        SSH_KEY=""
    fi

    echo "$SERVER|$AUTH|$SSH_KEY|$PASSWORD|$PORT" >> "$CONFIG_FILE"
    echo "Server saved."
}

load_servers() {
    if [[ ! -f "$CONFIG_FILE" ]] || [[ ! -s "$CONFIG_FILE" ]]; then
        echo "No servers configured."
        add_server
    fi

    mapfile -t SERVERS < "$CONFIG_FILE"
}

select_server() {
    echo "Available servers:"
    for i in "${!SERVERS[@]}"; do
        echo "$((i+1))) ${SERVERS[i]}"
    done

    read -p "Select server number: " IDX
    IDX=$((IDX-1))

    SERVER_INFO="${SERVERS[$IDX]}"
}

deploy_packages() {

    read -p "Enter local packages folder: " LOCAL_PACKAGES

    if [[ ! -d "$LOCAL_PACKAGES" ]]; then
        echo "Folder not found."
        return
    fi

    IFS='|' read -r SERVER AUTH SSH_KEY PASSWORD PORT <<< "$SERVER_INFO"

    CONTROL_SOCKET="/tmp/deploy_mux_$(date +%s)"

    SSH_OPTS="-n -p $PORT -o ControlMaster=auto -o ControlPath=$CONTROL_SOCKET -o ControlPersist=10m"
    SCP_OPTS="-P $PORT -o ControlPath=$CONTROL_SOCKET"

    if [[ "$AUTH" == "key" ]]; then
        SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
        SCP_OPTS="$SCP_OPTS -i $SSH_KEY"
        ssh $SSH_OPTS -Nf "$SERVER"
    else
        sshpass -p "$PASSWORD" ssh $SSH_OPTS -Nf "$SERVER"
    fi

    echo "Scanning packages..."

    while IFS= read -r FILE; do

        REL_PATH="${FILE#$LOCAL_PACKAGES/}"
        REMOTE_FILE="$REMOTE_BASE/$REL_PATH"
        REMOTE_DIR=$(dirname "$REMOTE_FILE")

        echo "Checking $REL_PATH"

        if [[ "$AUTH" == "key" ]]; then
            ssh $SSH_OPTS "$SERVER" "[ -f '$REMOTE_FILE' ]"
        else
            sshpass -p "$PASSWORD" ssh $SSH_OPTS "$SERVER" "[ -f '$REMOTE_FILE' ]"
        fi

        if [[ $? -eq 0 ]]; then
            echo "Skip (exists)"
            continue
        fi

        echo "Uploading..."

        if [[ "$AUTH" == "key" ]]; then
            ssh $SSH_OPTS "$SERVER" "mkdir -p '$REMOTE_DIR'"
            scp $SCP_OPTS "$FILE" "$SERVER:$REMOTE_FILE"
        else
            sshpass -p "$PASSWORD" ssh $SSH_OPTS "$SERVER" "mkdir -p '$REMOTE_DIR'"
            sshpass -p "$PASSWORD" scp $SCP_OPTS "$FILE" "$SERVER:$REMOTE_FILE"
        fi

        echo "Uploaded $REL_PATH"

    done < <(find "$LOCAL_PACKAGES" -type f)

    echo "All packages processed."

    ssh -S "$CONTROL_SOCKET" -O exit "$SERVER" 2>/dev/null
}

main_menu() {
    while true; do
        echo
        echo "1) Upload packages"
        echo "2) Add server"
        echo "3) Exit"
        read -p "Choice: " CHOICE

        case $CHOICE in
            1)
                load_servers
                select_server
                deploy_packages
                ;;
            2)
                add_server
                ;;
            3)
                exit 0
                ;;
            *)
                echo "Invalid option"
                ;;
        esac
    done
}

check_dependencies
main_menu

