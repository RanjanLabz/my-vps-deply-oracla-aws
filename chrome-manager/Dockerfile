FROM python:3.12-slim

# Install Chrome dependencies + Xvfb + curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl gnupg2 xvfb \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    libxfixes3 libxss1 libxtst6 \
    fonts-liberation xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright Chromium (standalone binary, no snap)
RUN pip install --no-cache-dir playwright==1.52.0 \
    && playwright install chromium \
    && rm -rf /tmp/*

# Find the Playwright Chromium binary and symlink it
RUN CHROME_PATH=$(find /root/.cache/ms-playwright -name "chrome" -path "*/chrome-linux/chrome" | head -1) \
    && ln -sf "$CHROME_PATH" /usr/bin/chromium \
    && echo "Chromium symlinked from: $CHROME_PATH"

WORKDIR /app

# Install Python deps
COPY chrome-manager/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy Chrome Manager API
COPY chrome-manager/main.py /app/main.py

# Copy extension
COPY extension/ /app/extension/

# Default environment
ENV DISPLAY=:99
ENV CHROME_BINARY=/usr/bin/chromium
ENV EXTENSION_DIR=/app/extension
ENV BACKEND_WS_URL=ws://flowkit-backend:9222
ENV BACKEND_HTTP_URL=http://flowkit-backend:8100
ENV CDP_PORT_START=9223
ENV MAX_INSTANCES=3

EXPOSE 8200
EXPOSE 9223-9230

CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 & python -m uvicorn main:app --host 0.0.0.0 --port 8200"]
