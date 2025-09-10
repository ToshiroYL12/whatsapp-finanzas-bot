FROM node:20-slim

# Install libraries required by Chromium (used by whatsapp-web.js/puppeteer)
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates fonts-liberation gnupg wget \
  libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdbus-1-3 \
  libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
  libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 libxrender1 libxshmfence1 \
  xdg-utils libu2f-udev libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (production only)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Simple entry that writes token.json from secret if provided
RUN printf '#!/bin/sh\nset -e\n' \
  'if [ -n "$GOOGLE_TOKEN_JSON" ]; then echo "$GOOGLE_TOKEN_JSON" > /app/token.json; fi\n' \
  'exec node src/bot.js\n' > /app/entry.sh \
  && chmod +x /app/entry.sh

ENV NODE_ENV=production \
    TZ=America/Lima

# Data path used by LocalAuth in src/bot.js is .wwebjs_auth; we will mount a volume here in Fly.io
CMD ["/app/entry.sh"]

