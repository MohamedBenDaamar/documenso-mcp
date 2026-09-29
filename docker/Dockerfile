# Image for self-hosting documenso-mcp (for example next to a Documenso instance).
# Manufact does not use it: it builds with `npm run build` and runs `npm start`.
#
#   docker build -f docker/Dockerfile -t documenso-mcp .
#   docker run -p 3000:3000 -e DOCUMENSO_URL=https://sign.example.com -e MCP_URL=https://mcp.example.com documenso-mcp

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The build loads index.ts, which validates the configuration; the real URL is read again at startup.
RUN DOCUMENSO_URL=https://documenso.invalid npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/.mcp-use/build ./.mcp-use/build
USER node
EXPOSE 3000
# --with-inspector serves the mcp-use Inspector at /mcp/inspector, so visitors can browse the tools.
CMD ["node_modules/.bin/mcp-use", "start", "--with-inspector"]
