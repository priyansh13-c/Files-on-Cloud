FROM node:20-alpine
WORKDIR /app
# copy root package files 
COPY package*.json ./
# install dependecies
RUN npm install 
# copy entire project 
COPY . .
# create the uploads directory
RUN mkdir -p uploads
# Create uploads directory (important for runtime)
RUN mkdir -p uploads
# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# Fix permissions
RUN chown -R appuser:appgroup /app
USER appuser
ENV NODE_ENV=production
EXPOSE 5000
CMD ["npm", "start"]