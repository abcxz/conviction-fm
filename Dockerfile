FROM node:22-slim
WORKDIR /app
RUN npm install conviction-mcp
ENTRYPOINT ["node", "node_modules/conviction-mcp/build/index.js"]
