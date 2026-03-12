var MTPpacket = require("./MTPResponse"),
  singleton = require("./Singleton");

let SecretSessionManager = require("../SecretSessionManager");
let SecretVariants = require("../SecretVariants");
let fs = require("fs");
let path = require("path");

const HEADER_SIZE = 12;

module.exports = {
  handleClientJoining: function (sock) {
    // Clean up session on disconnect
    sock.on("close", () => {
      SecretSessionManager.endSession(sock);
    });

    sock.on("data", (data) => {
      console.log("\nReceived request");

      // Parse header (first 12 bytes)
      let version = parseBitPacket(data, 0, 5);
      let requestType = parseBitPacket(data, 29, 3);
      let mediaType = parseBitPacket(data, 64, 4);
      let fileNameSize = parseBitPacket(data, 68, 28);

      // Extract filename
      let fileNameBytes = data.slice(12, 12 + fileNameSize);
      let fileName = bytesToString(fileNameBytes);

      console.log("Version:", version);
      console.log("Request Type:", requestType);
      console.log("File Name:", fileName);
      console.log("Request packet bits:");
      printPacketBit(data);

      // Version check
      if (version !== 11) {
        console.log("ERROR: Invalid MTP version. Expected 11, got", version);
        sendBusyResponse(sock);
        return;
      }

      // Route by request type
      switch (requestType) {
        case 1: // Query
          handleQuery(sock, fileName);
          break;
        case 2: // Secret - start secret session
          handleSecretRequest(sock);
          break;
        case 3: // Reset
          handleReset(sock);
          break;
        case 4: // ACK
          handleAck(sock, fileName);
          break;
        case 5: // Complete
          handleComplete(sock);
          break;
        default:
          console.log("Unknown request type:", requestType);
          sendBusyResponse(sock);
      }
    }); // Closes sock.on("data")
  } // Closes handleClientJoining
};

// ============================================================
// Request type handlers
// ============================================================

function handleQuery(sock, fileName) {
  let session = SecretSessionManager.getSession(sock);

  console.log("Looking for file:", fileName);

  fs.readdir(path.join(__dirname, "images"), (err, files) => {
    if (err) {
      console.log("Error reading images directory:", err);
      return;
    }

    let foundFile = null;
    for (let file of files) {
      let nameWithoutExt = file.split(".")[0];
      if (nameWithoutExt.toLowerCase() === fileName.toLowerCase()) {
        foundFile = path.join(__dirname, "images", file);
        break;
      }
    }

    if (!foundFile) {
      console.log("File not found:", fileName);
      sendNotFoundResponse(sock);
      return;
    }

    console.log("File found:", foundFile);

    fs.readFile(foundFile, (err, fileData) => {
      if (err) {
        console.log("Error reading file:", err);
        return;
      }

      console.log("File size:", fileData.length, "bytes");
      sendFileData(sock, fileData);

      // If in secret session, track file request and send key part
      if (session && SecretSessionManager.isSessionValid(sock)) {
        let result = SecretSessionManager.recordFileRequest(sock, fileName);
        if (result.valid) {
          console.log(
            "Secret session: file",
            result.fileIndex + 1,
            "of 3 received correctly"
          );

          // Send key part after file data
          let keyPartInfo = SecretSessionManager.getNextKeyPart(sock);
          if (keyPartInfo) {
            console.log(
              "Sending key part",
              keyPartInfo.index,
              ":",
              keyPartInfo.part
            );
            sendSecretMessage(sock, 2, keyPartInfo.part, keyPartInfo.index);
          }
        } else {
          console.log(
            "Secret session: wrong file order. Expected:",
            result.expected,
            "Got:",
            result.got
          );
          sendSecretMessage(sock, 5, "Wrong file order. Session reset.", 0);
          SecretSessionManager.endSession(sock);
        }
      }
    });
  });
}

function handleSecretRequest(sock) {
  // End any existing session
  SecretSessionManager.endSession(sock);

  // Start new session
  let sessionInfo = SecretSessionManager.startSession(sock);
  console.log("Secret session started. Variant:", sessionInfo.variantIndex);
  console.log("Riddle:", sessionInfo.riddle);

  // Send riddle (response type 4, flag 1)
  sendSecretMessage(sock, 1, sessionInfo.riddle, 0);
}

function handleReset(sock) {
  console.log("Resetting secret session");
  SecretSessionManager.endSession(sock);

  // Send ack receipt
  sendSecretMessage(sock, 3, "Session reset.", 0);
}

function handleAck(sock, fileName) {
  let partIndex = parseInt(fileName) || 0;
  console.log("ACK received for key part:", partIndex);

  SecretSessionManager.acknowledgeKeyPart(sock, partIndex);

  // Send ack receipt
  sendSecretMessage(sock, 3, "ACK received for part " + partIndex, 0);
}

function handleComplete(sock) {
  if (!SecretSessionManager.isReadyForSecret(sock)) {
    console.log(
      "Client not ready for secret - missing files or acknowledgments"
    );
    sendSecretMessage(sock, 5, "Not ready. Complete the sequence first.", 0);
    return;
  }

  let encryptedSecret = SecretSessionManager.getEncryptedSecret(sock);
  console.log("Sending encrypted secret");

  // Send encrypted secret (flag 4)
  sendSecretMessage(sock, 4, encryptedSecret, 0);

  // End the session
  SecretSessionManager.endSession(sock);
}

// ============================================================
// Response builders
// ============================================================

function sendFileData(sock, fileData) {
  const CHUNK_SIZE = 65536;
  const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);

  console.log("Splitting file into", totalChunks, "packet(s)");

  for (let seq = 0; seq < totalChunks; seq++) {
    let chunkStart = seq * CHUNK_SIZE;
    let chunkEnd = Math.min(chunkStart + CHUNK_SIZE, fileData.length);
    let chunkData = fileData.slice(chunkStart, chunkEnd);
    let isLast = seq === totalChunks - 1 ? 1 : 0;

    let packet = Buffer.alloc(HEADER_SIZE + chunkData.length);
    packet.fill(0);

    storeBitPacket(packet, 11, 0, 5); // Version
    storeBitPacket(packet, 1, 5, 3); // Response Type: 1=Found
    storeBitPacket(packet, seq, 8, 24); // Sequence Number
    storeBitPacket(packet, 0, 32, 32); // Reserved
    storeBitPacket(packet, isLast, 64, 1); // Last flag
    storeBitPacket(packet, chunkData.length, 65, 31); // Payload size

    chunkData.copy(packet, HEADER_SIZE);

    console.log(
      "Sending packet",
      seq + 1,
      "/",
      totalChunks,
      "(" + chunkData.length + " bytes, Last=" + isLast + ")"
    );
    sock.write(packet);
  }
  console.log("All file packets sent");
}

function sendSecretMessage(sock, flag, message, keyPartIndex) {
  let payloadBuf = Buffer.from(message);
  let packet = Buffer.alloc(HEADER_SIZE + payloadBuf.length);
  packet.fill(0);

  storeBitPacket(packet, 11, 0, 5); // Version
  storeBitPacket(packet, 4, 5, 3); // Response Type: 4=Secret
  storeBitPacket(packet, 0, 8, 24); // Sequence Number: 0
  storeBitPacket(packet, flag, 32, 3); // Secret Flag (bits 32-34)
  storeBitPacket(packet, keyPartIndex, 35, 2); // Key Part Index (bits 35-36)
  storeBitPacket(packet, 1, 64, 1); // Last flag: 1
  storeBitPacket(packet, payloadBuf.length, 65, 31); // Payload size

  payloadBuf.copy(packet, HEADER_SIZE);

  console.log(
    "Sending secret message (flag=" +
      flag +
      ", payload=" +
      payloadBuf.length +
      " bytes)"
  );
  sock.write(packet);
}

function sendNotFoundResponse(sock) {
  let packet = Buffer.alloc(HEADER_SIZE);
  packet.fill(0);

  storeBitPacket(packet, 11, 0, 5);
  storeBitPacket(packet, 2, 5, 3);
  storeBitPacket(packet, 0, 8, 24);
  storeBitPacket(packet, 0, 32, 32);
  storeBitPacket(packet, 1, 64, 1);
  storeBitPacket(packet, 0, 65, 31);

  console.log('Sending "Not Found" response');
  sock.write(packet);
}

function sendBusyResponse(sock) {
  let packet = Buffer.alloc(HEADER_SIZE);
  packet.fill(0);

  storeBitPacket(packet, 11, 0, 5);
  storeBitPacket(packet, 3, 5, 3);
  storeBitPacket(packet, 0, 8, 24);
  storeBitPacket(packet, 0, 32, 32);
  storeBitPacket(packet, 1, 64, 1);
  storeBitPacket(packet, 0, 65, 31);

  console.log('Sending "Busy" response');
  sock.write(packet);
}

function handleClientLeaving(sock) {
  SecretSessionManager.endSession(sock);
}

// ============================================================
// Bit-level helpers
// ============================================================

function storeBitPacket(packet, value, offset, length) {
  let lastBitPosition = offset + length - 1;
  let number = value.toString(2);
  number = number.length > length ? number.slice(number.length - length) : number.padStart(length, '0');
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

function parseBitPacket(packet, offset, length) {
  let number = "";
  for (var i = 0; i < length; i++) {
    let bytePosition = Math.floor((offset + i) / 8);
    let bitPosition = 7 - ((offset + i) % 8);
    let bit = (packet[bytePosition] >> bitPosition) % 2;
    number = (number << 1) | bit;
  }
  return number;
}

function printPacketBit(packet) {
  var bitString = "";
  for (var i = 0; i < packet.length; i++) {
    var b = "00000000" + packet[i].toString(2);
    if (i > 0 && i % 4 == 0) bitString += "\n";
    bitString += " " + b.substr(b.length - 8);
  }
  console.log(bitString);
  return bitString;
}
