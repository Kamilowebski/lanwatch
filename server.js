const http = require("node:http");

const port = Number(process.env.PORT) || 3000;

const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Serwer Lanwatch działa.\n");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Serwer Lanwatch działa na porcie ${port}.`);
});
