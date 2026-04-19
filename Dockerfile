# 1-Bosqich: Build
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

# 2-Bosqich: Production
FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# picomatch 4.0.3 → 4.0.4 ga bevosita almashtirish (npm install ishlatmasdan)
RUN npm pack picomatch@4.0.4 --pack-destination /tmp && \
    tar -xzf /tmp/picomatch-4.0.4.tgz -C /tmp && \
    cp -r /tmp/package/. /usr/local/lib/node_modules/npm/node_modules/picomatch/ && \
    rm -rf /tmp/picomatch-4.0.4.tgz /tmp/package

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

USER node

EXPOSE 3000

CMD ["node", "server.js"]