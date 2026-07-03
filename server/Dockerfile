# Built from the REPOSITORY ROOT as the Docker context (like the reference repo):
#   flyctl deploy --config server/fly.toml --dockerfile server/Dockerfile .
# Stage 1 builds the Three.js client with Vite; stage 2 is the slim runtime that
# serves client/dist + the gateway API from one Fly machine.

# ---- stage 1: build the client ----
FROM node:20-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---- stage 2: runtime ----
FROM node:20-slim
WORKDIR /app/server

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./
# gateway serves ../client/dist statically (same sibling layout as local dev)
COPY --from=client-build /build/client/dist /app/client/dist

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
