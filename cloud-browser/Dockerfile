FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM mcr.microsoft.com/playwright:v1.62.1-noble
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist
COPY --from=build --chown=pwuser:pwuser /app/package.json ./package.json
USER pwuser
EXPOSE 8080
CMD ["node", "dist/server.js"]
