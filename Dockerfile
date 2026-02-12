FROM node:24-slim

# Native build dependencies for better-sqlite3, sharp, bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (cache layer for npm install)
COPY aide-rap/package.json aide-rap/package-lock.json* ./
COPY aide-rap/aide-frame/js/aide_frame/package.json aide-rap/aide-frame/js/aide_frame/package-lock.json* ./aide-frame/js/aide_frame/

# Install dependencies
RUN npm ci --omit=dev
RUN cd aide-frame/js/aide_frame && npm ci --omit=dev

# Copy everything else
COPY aide-rap/ .

EXPOSE 18354

CMD ["node", "app/rap.js", "-s", "irma"]
