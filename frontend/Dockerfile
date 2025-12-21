FROM node:18-alpine

WORKDIR /app

# Install dependencies match package.json
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 5173

# Start dev server (allowing host access)
CMD ["npm", "run", "dev", "--", "--host"]
