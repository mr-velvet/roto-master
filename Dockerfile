FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 5031
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:5031/api/health || exit 1
CMD ["node", "server.js"]
