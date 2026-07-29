FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY types ./types
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/data && \
    chown -R nodejs:nodejs /app/data

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --chown=nodejs:nodejs core ./core
COPY --chown=nodejs:nodejs platforms ./platforms
COPY --chown=nodejs:nodejs util ./util
COPY --chown=nodejs:nodejs LICENSE ./LICENSE

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    TZ=Asia/Shanghai

EXPOSE 3000

USER nodejs

CMD ["node", "dist/server.js"]
