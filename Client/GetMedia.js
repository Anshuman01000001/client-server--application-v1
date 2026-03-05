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
let receivedData = Buffer.alloc(0); // Buffer to collect all chunks
let expectedPayloadSize = 0;
let headerReceived = false;
let connectionTimeout;
let transferTimeout;

// Step 1: Connection timeout (10 seconds)
connectionTimeout = setTimeout(() => {
  console.log('ERROR: Connection timeout - server did not respond within 10 seconds');
  client.destroy();
}, 10000);

client.connect(serverPort, serverIP, () => {
  console.log('Connected to server');
  // Clear connection timeout once connected
  clearTimeout(connectionTimeout);
  
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
  // Accumulate received data
  receivedData = Buffer.concat([receivedData, data]);
  
  // Parse header once we have at least 12 bytes
  if (!headerReceived && receivedData.length >= 12) {
    let responseVersion = parseBitPacket(receivedData, 0, 5);
    let responseType = parseBitPacket(receivedData, 5, 3);
    let sequenceNumber = parseBitPacket(receivedData, 8, 24);
    let lastPacketFlag = parseBitPacket(receivedData, 64, 1);
    expectedPayloadSize = parseBitPacket(receivedData, 65, 31);
    
    // Step 4: Validate response header
    if (responseVersion !== 11) {
      console.log('ERROR: Invalid MTP version in response. Expected 11, got', responseVersion);
      clearTimeout(transferTimeout);
      client.destroy();
      return;
    }
    
    if (responseType < 1 || responseType > 3) {
      console.log('ERROR: Invalid response type. Expected 1-3, got', responseType);
      clearTimeout(transferTimeout);
      client.destroy();
      return;
    }
    
    if (expectedPayloadSize < 0) {
      console.log('ERROR: Invalid payload size in response');
      clearTimeout(transferTimeout);
      client.destroy();
      return;
    }
    
    console.log('Received response from server');
    console.log('Response Header:');
    console.log('  Version:', responseVersion);
    console.log('  Response Type:', responseType, 
      responseType === 1 ? '(Found)' : 
      responseType === 2 ? '(Not Found)' : 
      responseType === 3 ? '(Busy)' : '(Other)');
    console.log('  Sequence Number:', sequenceNumber);
    console.log('  Last Packet:', lastPacketFlag === 1 ? 'Yes' : 'No');
    console.log('  Expected Payload Size:', expectedPayloadSize, 'bytes');
    
    headerReceived = true;
    
    // Step 2: Transfer timeout (30 seconds) - starts after header received
    transferTimeout = setTimeout(() => {
      console.log('ERROR: Transfer timeout - file transfer did not complete within 30 seconds');
      client.destroy();
    }, 30000);
    
    if (responseType === 2) {
      console.log('File not found on server');
      clearTimeout(transferTimeout);
      client.destroy();
      return;
    }
    
    if (responseType === 3) {
      console.log('Server is busy or version mismatch');
      clearTimeout(transferTimeout);
      client.destroy();
      return;
    }
  }
  
  // Check if we've received the complete packet (header + payload)
  if (headerReceived && receivedData.length >= 12 + expectedPayloadSize) {
    console.log('Complete file received! Total bytes:', receivedData.length);
    
    // Clear transfer timeout - file transfer complete
    clearTimeout(transferTimeout);
    
    // Extract file data (starts at byte 12)
    let fileData = receivedData.slice(12, 12 + expectedPayloadSize);
    console.log('Extracted file data:', fileData.length, 'bytes');
    
    // Create media folder if it doesn't exist
    const mediaFolder = 'media';
    fs.mkdir(mediaFolder, { recursive: true }, (err) => {
      if (err) {
        console.log('Error creating media folder:', err);
        client.destroy();
        return;
      }
      
      // Save to file in media folder
      let outputFileName = mediaFolder + '/downloaded_' + fileName;
      fs.writeFile(outputFileName, fileData, (err) => {
        if (err) {
          console.log('Error saving file:', err);
          client.destroy();
          return;
        }
        
        console.log('File saved as:', outputFileName);
        console.log('Opening file...');
        
        // Open the file with default viewer
        open(outputFileName).then(() => {
          console.log('File opened successfully!');
          client.destroy();
        }).catch((err) => {
          console.log('Could not auto-open file:', err.message);
          console.log('Please open manually:', outputFileName);
          client.destroy();
        });
      });
    });
  } else if (headerReceived) {
    console.log('Received chunk... Total so far:', receivedData.length, 'bytes. Waiting for', (12 + expectedPayloadSize - receivedData.length), 'more bytes');
  }
});

// Step 3: Better connection reset handling
client.on('error', (err) => {
  clearTimeout(connectionTimeout);
  clearTimeout(transferTimeout);
  
  // Step 4: Differentiate error types
  if (err.code === 'ECONNREFUSED') {
    console.log('ERROR: Connection refused - server is not running');
  } else if (err.code === 'ENOTFOUND') {
    console.log('ERROR: Server host not found - check IP address');
  } else if (err.code === 'ETIMEDOUT') {
    console.log('ERROR: Connection timed out - server is unreachable');
  } else if (err.code === 'ECONNRESET') {
    console.log('ERROR: Connection reset by server');
  } else {
    console.log('ERROR: Connection error -', err.message);
  }
});

client.on('close', () => {
  console.log('Connection closed');
  // Step 3: Clear timeouts on unexpected close
  clearTimeout(connectionTimeout);
  clearTimeout(transferTimeout);
});
