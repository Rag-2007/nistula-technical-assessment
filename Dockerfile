FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc --project tsconfig.json

FROM node:22-alpine AS runner

WORKDIR /app

RUN addgroup -S nistula && adduser -S nistula -G nistula

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN chown -R nistula:nistula /app
USER nistula

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/webhook/health || exit 1

CMD ["node", "dist/main.js"]
