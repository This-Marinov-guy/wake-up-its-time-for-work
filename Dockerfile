FROM node:20-alpine

ENV NODE_ENV=production
# Cap Node memory (in MB) – keeps it from ever growing large
ENV NODE_OPTIONS="--max-old-space-size=64"

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-cache

COPY wake.js ./

# databases.json will be mounted at runtime
CMD ["node", "wake.js"]
