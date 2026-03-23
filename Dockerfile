FROM node:22-slim
WORKDIR /app
COPY mcp/package.json mcp/package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production
COPY mcp/build/ ./build/
ENTRYPOINT ["node", "build/index.js"]
