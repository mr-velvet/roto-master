FROM node:20-alpine
WORKDIR /app

# yt-dlp + ffmpeg pro Fluxo B (vídeo de URL/YouTube)
RUN apk add --no-cache ffmpeg python3 py3-pip ca-certificates wget && \
    wget -q -O /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 5031
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:5031/api/health || exit 1
CMD ["node", "server.js"]
