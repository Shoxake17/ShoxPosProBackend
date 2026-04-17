# Debian-based imidj (barqaror va build vositalari tayyor)
FROM node:20

WORKDIR /app    

# Faqat package fayllarini nusxalash
COPY package*.json ./

# Build vositalari tayyor bo'lgani uchun tez va xatosiz o'rnaydi
RUN npm install --only=production --legacy-peer-deps

# Qolgan kodni nusxalash
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]