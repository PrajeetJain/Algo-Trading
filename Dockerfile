# Aindra Trader — single-container deployment.
# Builds the frontend, then runs the API server which also serves the UI.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Runtime data (SQLite, JSONL ledger, Kite session) lives in a volume.
VOLUME ["/app/.aindra-data"]
EXPOSE 8787
ENV API_PORT=8787
ENV API_HOST=0.0.0.0
CMD ["node", "server/index.js"]
