# 1-Bosqich: Build
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --legacy-peer-deps && \
    npm update --legacy-peer-deps

COPY . .

# 2-Bosqich: Production
FROM node:22-slim

WORKDIR /app

# Tizim paketlarini yangilash + npm'ni so'nggi versiyaga ko'tarish
RUN apt-get update && apt-get upgrade -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    npm install -g npm@latest

# Faqat production node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

# Root bo'lmagan foydalanuvchi
USER node

EXPOSE 3000

CMD ["node", "server.js"]