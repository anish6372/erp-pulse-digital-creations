FROM node:22-alpine
WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /app/data /app/uploads /app/private
VOLUME ["/app/data", "/app/uploads", "/app/private"]
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/server.js"]
