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

# Production konteynerda npm CLI runtime paytida ishlatilmaydi (faqat "node server.js"
# ishga tushadi), shuning uchun uni butunlay olib tashlaymiz. Bu npm ichiga o'rnatilgan
# bundled paketlardagi (brace-expansion, ip-address, pacote, sigstore, tar) barcha CVE'larni
# tuzatish o'rniga muammoni ildizidan yo'q qiladi.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/share/man/man1/npm* /usr/local/share/man/man1/npx* \
    /usr/local/share/man/man5/*npm* /usr/local/share/man/man7/*npm*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

USER node

EXPOSE 3000

CMD ["node", "server.js"]