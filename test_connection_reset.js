let net = require("net");
let server = net.createServer((sock) => {
  console.log("Client connected - closing immediately...");
  sock.destroy();
});
server.listen(3002, () => console.log("Test server on :3002"));
