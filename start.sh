#!/bin/bash

(cd doda_agent && deno run --allow-all server.ts) &

# Wait for a few seconds to ensure the server starts
sleep 5

# Run electron from its directory
(cd doda_electron && npm start)

# print
echo "Doda AI+UI Running!"