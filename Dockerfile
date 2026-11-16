# Petalwake as a container: builds dist/ and serves it with nginx on port 8080.
#   docker build -t petalwake . && docker run -p 8080:8080 petalwake
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN node tools/build.mjs --out /dist

FROM nginx:1.27-alpine
COPY tools/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /dist /usr/share/nginx/html
EXPOSE 8080
