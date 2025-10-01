FROM node:alpine

WORKDIR /frontend
RUN npx create-react-app .
RUN npm i
COPY /src/App.js ./src/App.js
RUN npm i html2pdf.js

EXPOSE 3000
CMD [ "npm", "start" ]