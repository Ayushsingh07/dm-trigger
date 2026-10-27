# ReplyLo — single always-on instance with a persistent volume at /data.
# Build: docker build -t replylo .
# Run:   docker run -p 3000:3000 -v replylo-data:/data -e DATABASE_PATH=/data/replylo.db replylo

FROM node:24-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/replylo.db

WORKDIR /app

# Install production deps first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# App code + prebuilt static assets.
COPY server.js ./
COPY src ./src
COPY public ./public

# Non-root user; /data is the mount point for the persistent volume.
RUN useradd --system --create-home --uid 10001 replylo \
 && mkdir -p /data \
 && chown -R replylo:replylo /app /data
USER replylo

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
