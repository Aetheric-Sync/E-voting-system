# Stage 1: build
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web

# Install only the packages needed for the web build
RUN npm ci -w @evote/web --include-workspace-root=false

# Build the Next.js app
WORKDIR /repo/apps/web
RUN npm run build

# Stage 2: runtime — Next.js standalone output
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Copy the Next.js standalone bundle (self-contained, no npm install needed)
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./.next/static
COPY --from=build /repo/apps/web/public ./public

EXPOSE 3001

# API_URL is injected at runtime by docker-compose or the orchestrator
ENV API_URL=http://api:3000

CMD ["node", "server.js"]

