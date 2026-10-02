FROM node:22-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@11.1.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG ARC_NETWORK=testnet
ARG MAINNET_SIGNING=0
ENV VITE_ARC_NETWORK=${ARC_NETWORK}
ENV VITE_MAINNET_SIGNING=${MAINNET_SIGNING}
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/rpc-proxy.conf /etc/nginx/rpc-proxy.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
