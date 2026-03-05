let net = require("net");
let server = net.createServer((sock) => {
  console.log("Client connected - sending invalid response...");
  // Send header with wrong version (version 5 instead of 11)
  let header = Buffer.alloc(12);
  header.fill(0);
  header[0] = 0xA0; // Version 5 (bits 0-4)
  sock.write(header);
  sock.destroy();
});
server.listen(3003, () => console.log("Test server on :3003"));
