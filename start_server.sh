#!/bin/bash

# Navigate to the directory containing this script
cd "$(dirname "$0")"

# Activate the virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Define the log file
LOG_FILE="server_sync.log"

echo "Cleaning up any old PyInstaller bundled temporary files..."
find /tmp -maxdepth 1 -name "_MEI*" -mmin +1440 -user $(whoami) -exec rm -rf {} \; 2>/dev/null

echo "Starting Defect Tagger Sync Server in the background..."
echo "Logs will be written to: $LOG_FILE"

# Run the server in the background, redirecting output to the log file
# The '&' pushes it to the background
# 'nohup' prevents it from dying if the terminal is closed
nohup python main.py > "$LOG_FILE" 2>&1 &

# Capture the process ID (PID)
PID=$!

echo "Server started successfully! (PID: $PID)"
echo "To stop the server later, you can run: kill $PID"
echo "Or use: pkill -f 'python main.py'"
