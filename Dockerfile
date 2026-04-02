FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend install
COPY frontend ./frontend
RUN npm --prefix frontend run build

FROM node:22-alpine
WORKDIR /app
COPY Backend/package*.json ./Backend/
RUN npm --prefix Backend install --omit=dev
COPY Backend ./Backend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "Backend/server.js"]
