#!/bin/bash
# La Pizzario Order Server — Mac/Linux starter
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
  echo ""
  echo "  Node.js is not installed. Get it from: https://nodejs.org"
  echo "  (Choose the LTS version, then run this script again)"
  echo ""
  exit 1
fi

echo ""
echo "  LA PIZZARIO ORDER SERVER STARTING..."
echo "  Keep this terminal OPEN while taking orders."
echo ""
echo "  Website:    http://localhost:3000"
echo "  Dashboard:  http://localhost:3000/dashboard.html"
echo ""

(sleep 1 && open "http://localhost:3000/dashboard.html" 2>/dev/null || xdg-open "http://localhost:3000/dashboard.html" 2>/dev/null) &
node server.js
