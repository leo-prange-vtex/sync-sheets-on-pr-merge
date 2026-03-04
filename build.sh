#!/bin/bash

# Build script with error handling
set -e

echo "Building distribution..."
export NODE_OPTIONS="--max-old-space-size=4096"

# Try npm first
if command -v npm &> /dev/null; then
    npm run build
else
    # Fallback to direct ncc
    if [ -d "node_modules" ]; then
        ./node_modules/.bin/ncc build src/index.js -o dist
    else
        echo "Error: npm not found and node_modules not installed"
        exit 1
    fi
fi

echo "✓ Build complete. dist/index.js is ready."
