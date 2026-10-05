# Stage 1: Build Frontend Assets
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace package definitions
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY apps/frontend/package*.json ./apps/frontend/

# Install dependencies
RUN npm install

# Copy source files
COPY packages/shared-types ./packages/shared-types
COPY apps/frontend ./apps/frontend

# Build shared-types first, then frontend
RUN npm run build:shared
RUN npm run build:frontend

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
