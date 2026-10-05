FROM node:20-bookworm-slim

# Install system dependencies required by Playwright and headless Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root workspace configurations
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY apps/backend/package*.json ./apps/backend/

# Install dependencies across monorepo
RUN npm install

# Install Playwright browser binary
RUN npx playwright install chromium

# Copy code
COPY packages/shared-types ./packages/shared-types
COPY apps/backend ./apps/backend

# Build shared types and backend
RUN npm run build:shared
RUN npm run build:backend

# Create storage directories
RUN mkdir -p /app/storage/invoices /app/storage/sessions

EXPOSE 3001

CMD ["node", "apps/backend/dist/index.js"]
