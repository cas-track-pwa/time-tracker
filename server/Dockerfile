FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 ships prebuilt binaries for linux/amd64 on Node 22; the build
# tools are a fallback for architectures without a prebuild.
COPY package.json package-lock.json* ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install --omit=dev \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY . .

ENV NODE_ENV=production \
    TZ=UTC \
    PORT=8787 \
    DB_PATH=/data/tt.sqlite

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "src/index.js"]
