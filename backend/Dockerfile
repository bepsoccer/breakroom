FROM node:alpine

WORKDIR /backend
COPY /src/. ./
RUN npm init -y
RUN npm pkg set type="module"
RUN npm i express node-fetch dotenv cors luxon
RUN npm i -D nodemon

EXPOSE 3001
CMD [ "npm", "start" ]