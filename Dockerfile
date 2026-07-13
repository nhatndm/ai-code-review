# ---- Build stage ----
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Production stage ----
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# git is required at runtime: simple-git sparse-clones the product-blueprint
# skills repo over HTTPS using the Atlassian API token.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN groupadd --system appuser \
    && useradd --system --gid appuser --create-home --home-dir /home/appuser appuser \
    && mkdir -p /app/skills-repo \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000
CMD ["node", "dist/index.js"]
