FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm ci -w @evote/core -w @evote/api --include-workspace-root=false \
 && npm run build -w @evote/core && npm run build -w @evote/api

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/core/package.json packages/core/package.json
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
RUN npm ci -w @evote/core -w @evote/api --omit=dev --include-workspace-root=false
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
