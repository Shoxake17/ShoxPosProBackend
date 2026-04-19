# 2-Bosqich: Production
FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# npm ichidagi zaif picomatch ni yangilash
RUN cd /usr/local/lib/node_modules/npm && \
    npm install picomatch@4.0.4 --no-save

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

USER node

EXPOSE 3000

CMD ["node", "server.js"]