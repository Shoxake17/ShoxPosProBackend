# 1-Bosqich: Build (Kutubxonalarni o'rnatish)
FROM node:20-slim AS builder

WORKDIR /app

# Build uchun kerak bo'ladigan minimal tizim paketlarini yangilash
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Barcha kutubxonalarni o'rnatish (shu jumladan devDependencies build uchun)
RUN npm install --legacy-peer-deps

COPY . .

# 2-Bosqich: Production (Faqat kerakli fayllar bilan yengil imidj)
FROM node:20-slim

WORKDIR /app

# Tizim xavfsizligi uchun paketlarni yangilab olish (Trivy xatolarini yopadi)
RUN apt-get update && apt-get upgrade -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Faqat production uchun kerakli kutubxonalarni builder'dan nusxalash
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

# Xavfsizlik uchun: Ilovani root foydalanuvchi nomidan emas, 'node' foydalanuvchisi nomidan ishga tushirish
USER node

EXPOSE 3000

CMD ["node", "server.js"]