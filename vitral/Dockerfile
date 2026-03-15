# ---------- Build stage ----------
FROM node:25-alpine AS builder

WORKDIR /app
ARG VITE_BACKEND_URL=
ARG VITE_BASE_PATH=/
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


# ---------- Production stage ----------
FROM nginx:alpine

# Remove default nginx static files
RUN rm -rf /usr/share/nginx/html/*

# Copy built app
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
