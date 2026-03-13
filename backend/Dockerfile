FROM node:25-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev
EXPOSE ${PORT}
ENV NODE_ENV=production
ENV ADDRESS=0.0.0.0
CMD ["node", "dist/index.js"]
