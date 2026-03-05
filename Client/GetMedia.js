let net = require("net");
let fs = require("fs");
let open = require("open");
// let MTPpacket = require("./MTPRequest"),// uncomment this line after you run npm install command

  singleton = require("./Singleton");

// call as GetImage -s <serverIP>:<port> -q <image name> -v <version>

// Enter your code for the client functionality here
// You should connect to the server and send the request packet
// You should receive the response packet from the server
// You should print the response packet in bits format
// You should extract the media data from the response packet
// You should save the image data to a file


//some helper functions
// return integer value of the extracted bits fragment
function parseBitPacket(packet, offset, length) {
  let number = "";
  for (var i = 0; i < length; i++) {
    // let us get the actual byte position of the offset
    let bytePosition = Math.floor((offset + i) / 8);
    let bitPosition = 7 - ((offset + i) % 8);
    let bit = (packet[bytePosition] >> bitPosition) % 2;
    number = (number << 1) | bit;
  }
  return number;
}

// Prints the entire packet in bits format
function printPacketBit(packet) {
  var bitString = "";

  for (var i = 0; i < packet.length; i++) {
    // To add leading zeros
    var b = "00000000" + packet[i].toString(2);
    // To print 4 bytes per line
    if (i > 0 && i % 4 == 0) bitString += "\n";
    bitString += " " + b.substr(b.length - 8);
  }
  console.log(bitString);
}
function bytes2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}

// Store integer value into the packet bit stream
function storeBitPacket(packet, value, offset, length) {
  let lastBitPosition = offset + length - 1;
  let number = value.toString(2).padStart(length, '0');  // Pad to required length
  let j = number.length - 1;
  for (let i = 0; i < number.length; i++) {
    let bytePosition = Math.floor(lastBitPosition / 8);
    let bitPosition = 7 - (lastBitPosition % 8);
    if (number.charAt(j--) == "0") {
      packet[bytePosition] &= ~(1 << bitPosition);
    } else {
      packet[bytePosition] |= 1 << bitPosition;
    }
    lastBitPosition--;
  }
}

// Get media type code from file extension
function getMediaType(filename) {
  let ext = filename.split('.').pop().toLowerCase();
  const mediaTypes = {
    'bmp': 1, 'jpeg': 2, 'jpg': 2, 'tiff': 3, 'gif': 4, 
    'png': 5, 'avi': 6, 'mp4': 7, 'mov': 8, 'raw': 15
  };
  return mediaTypes[ext] || 0;
}

// Parse command line arguments
let args = process.argv.slice(2);
let serverIP, serverPort, fileName, version = 11, requestType = 'query';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-s') {
    let serverInfo = args[i + 1].split(':');
    serverIP = serverInfo[0];
    serverPort = parseInt(serverInfo[1]);
  } else if (args[i] === '-q') {
    fileName = args[i + 1];
  } else if (args[i] === '-v') {
    version = parseInt(args[i + 1]);
  } else if (args[i] === '--type') {
    requestType = args[i + 1];
  }
}

console.log('Connecting to:', serverIP + ':' + serverPort);
console.log('Requesting file:', fileName);
console.log('MTP Version:', version);

// Create TCP connection to server
let client = new net.Socket();

client.connect(serverPort, serverIP, () => {
  console.log('Connected to server');
  
  // Create MTP request packet
  console.log('Sending request for:', fileName);
  
  // Separate filename and extension
  let fileNameParts = fileName.split('.');
  let fileNameOnly = fileNameParts[0];
  let mediaType = getMediaType(fileName);
  
  // Create 12-byte header + filename
  let HEADER_SIZE = 12;
  let fileNameBytes = Buffer.from(fileNameOnly);
  let packet = Buffer.alloc(HEADER_SIZE + fileNameBytes.length);
  
  // Fill header with zeros first
  packet.fill(0);
  
  // Set fields in the header
  storeBitPacket(packet, version, 0, 5);           // Version (bits 0-4)
  storeBitPacket(packet, 0, 5, 24);                // Reserved (bits 5-28)
  storeBitPacket(packet, 1, 29, 3);                // Request Type: 1=Query (bits 29-31)
  storeBitPacket(packet, Date.now(), 32, 32);      // Timestamp (bits 32-63)
  storeBitPacket(packet, mediaType, 64, 4);        // Media Type (bits 64-67)
  storeBitPacket(packet, fileNameBytes.length, 68, 28); // Filename size (bits 68-95)
  
  // Copy filename to payload (starting at byte 12)
  fileNameBytes.copy(packet, HEADER_SIZE);
  
  console.log('Request packet:');
  printPacketBit(packet);
  
  // Send packet to server
  client.write(packet);
});

client.on('data', (data) => {
  console.log('Received response from server');
  console.log('Response packet:');
  printPacketBit(data);
});

client.on('close', () => {
  console.log('Connection closed');
});

client.on('error', (err) => {
  console.log('Error:', err.message);
});
