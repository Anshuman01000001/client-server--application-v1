var MTPpacket = require("./MTPResponse"),
singleton = require("./Singleton");

// You need to add some statements here



module.exports = {
  handleClientJoining: function (sock) {
    sock.on("data", (data) => {
      console.log("Received request'");

      //parse of the header (first 12 bytes)
      let version = parseBitPacket(data, 0, 5);
      let requestType = parseBitPacket(data, 29,3);
      let mediaType = parseBitPacket(data, 64, 4);
      let fileNameSize = parseBitPacket(data, 68, 28);

      //extracting file name
      let fileNameBytes = data.slice(12, 12 + fileNameSize);
      let fileName = bytesToString(fileNameBytes);

      console.log("version: " + version);
      console.log("request type: " + requestType);
      console.log("file name: " + fileName);

      //printing the request packet in bits (temp for debugging)
      console.log("Request packet in bits: " + printPacketBit(data));


      // you may need to develop some helper functions
      // that are defined outside this export block

      let fs = require("fs");
      let path = require("path");

      //building the full file path now
      let filePath = path.join(__dirname, "images", fileName);
      console.log("looking for file: ", filePath);
      
      //cheaking if the file exists with various extensions
      let extensions = ['.gif', '.jpeg', '.jpg', '.png', '.bmp', '.tiff', '.avi', '.mp4', '.mov'];
      let foundFile = null;
      
      fs.readdir(path.join(__dirname, "images"), (err, files) => {
        if (err) {
          console.log("Error reading images directory:", err);
          return;
        }
        
        // Find the file by matching filename without extension
        for (let file of files) {
          let nameWithoutExt = file.split('.')[0];
          if (nameWithoutExt.toLowerCase() === fileName.toLowerCase()) {
            foundFile = path.join(__dirname, "images", file);
            break;
          }
        }
        
        if (!foundFile) {
          console.log('File not found:', fileName);
          // Send "Not Found" response (we'll do this in the next step)
          return;
        }

        console.log('File found:', foundFile);

        //reading the file
        fs.readFile(foundFile, (err, fileData) => {
          if (err) {
            console.log("error reading file:", err);
            return;
          }

          console.log("File size: ", fileData.length, "bytes");
          console.log("First 100 bytes: ", fileData.slice(0, 100));
          
          // Create MTP response packet
          let HEADER_SIZE = 12;
          let responsePacket = Buffer.alloc(HEADER_SIZE + fileData.length);

          // Fill with zeros first
          responsePacket.fill(0);

          // Build response header
          storeBitPacket(responsePacket, 11, 0, 5);          // Version
          storeBitPacket(responsePacket, 1, 5, 3);           // Response Type: 1=Found
          storeBitPacket(responsePacket, 0, 8, 24);          // Sequence Number: 0
          storeBitPacket(responsePacket, 0, 32, 32);         // Reserved
          storeBitPacket(responsePacket, 1, 64, 1);          // L? flag: 1=last packet
          storeBitPacket(responsePacket, fileData.length, 65, 31); // Payload size

          // Copy file data to packet (starting at byte 12)
          fileData.copy(responsePacket, HEADER_SIZE);

          console.log('Sending response packet...');
          console.log('Response header:');
          printPacketBit(responsePacket.slice(0, HEADER_SIZE));

          // Send response to client
          sock.write(responsePacket);
        });
      });
    }); // Closes sock.on("data")
  } // Closes handleClientJoining
};

function handleClientLeaving(sock) {
          // Enter your code here
        //
        // you may need to develop some helper functions
        // that are defined outside this export block
  
}

// Store integer value into the packet bit stream
function storeBitPacket(packet, value, offset, length) {
  let lastBitPosition = offset + length - 1;
  let number = value.toString(2).padStart(length, '0');
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


function bytesToString(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}

function bytes2number(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result ^= array[array.length - i - 1] << (8 * i);
  }
  return result;
}

// return integer value of a subset bits
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
