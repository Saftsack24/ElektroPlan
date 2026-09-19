# Planner-Image fuer die Entwicklung (Vite Dev Server).
FROM node:22-alpine

WORKDIR /workspace

# package-lock.json wird mitkopiert, damit `npm ci` exakt die getesteten
# Versionen installiert.
COPY package.json package-lock.json /workspace/
COPY apps/planner/package.json /workspace/apps/planner/
COPY packages/api-client/package.json /workspace/packages/api-client/
RUN npm ci

COPY apps/planner /workspace/apps/planner
COPY packages/api-client /workspace/packages/api-client

WORKDIR /workspace/apps/planner
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
