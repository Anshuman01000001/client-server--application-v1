let net = require("net");
let server = net.createServer((sock) => {
  console.log("Client connected - sending header only, then hanging...");
  // Create 12-byte header
  let header = Buffer.alloc(12);
  header.fill(0);
  sock.write(header);
  // Don't send any more data - will trigger 30 second timeout
});
server.listen(3001, () => console.log("Test server on :3001"));
