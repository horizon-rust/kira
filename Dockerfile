# Kira on Railway: the Discord bot, the work board and the MCP server, in one process.
# State lives on the volume mounted at /data (state.json, board.json, agents.json, seal-key.pem).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production KIRA_STATE=/data/state.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
COPY assets ./assets
COPY docker-entrypoint.sh ./
# Starts as root only to chown the volume, then drops to the node user (docker-entrypoint.sh).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/main.js"]
