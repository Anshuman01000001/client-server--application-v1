let net = require("net");
let fs = require("fs");
let open = require("open");
let VigenereCipher = require("../VigenereCipher");
let singleton = require("./Singleton");

// Helper functions


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
}

function bytes2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}

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

function getMediaType(filename) {
  let ext = filename.split(".").pop().toLowerCase();
  const mediaTypes = {
    bmp: 1, jpeg: 2, jpg: 2, tiff: 3, gif: 4,
    png: 5, avi: 6, mp4: 7, mov: 8, raw: 15,
  };
  return mediaTypes[ext] || 0;
}

function createRequestPacket(version, reqType, mediaType, fileName) {
  const HEADER_SIZE = 12;
  let fileNameBuf = Buffer.from(fileName);
  let packet = Buffer.alloc(HEADER_SIZE + fileNameBuf.length);
  packet.fill(0);

  storeBitPacket(packet, version, 0, 5);
  storeBitPacket(packet, 0, 5, 24);
  storeBitPacket(packet, reqType, 29, 3);
  storeBitPacket(packet, Date.now(), 32, 32);
  storeBitPacket(packet, mediaType, 64, 4);
  storeBitPacket(packet, fileNameBuf.length, 68, 28);

  fileNameBuf.copy(packet, HEADER_SIZE);
  return packet;
}

function parseRiddleSequence(riddle) {
  let sentences = riddle
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let sequence = [];

  for (let sentence of sentences) {
    let lower = sentence.toLowerCase();
    let file = null;

    if (
      lower.includes("rose") ||
      lower.includes("flower") ||
      lower.includes("love") ||
      lower.includes("romance") ||
      lower.includes("bloom") ||
      lower.includes("thorny")
    ) {
      file = "Rose";
    } else if (
      lower.includes("dog") ||
      lower.includes("best friend") ||
      lower.includes("man's best")
    ) {
      file = "Dog";
    } else if (
      lower.includes("swan") ||
      lower.includes("elegant bird") ||
      lower.includes("graceful bird") ||
      lower.includes("lake") ||
      lower.includes("grace")
    ) {
      file = "Swan";
    } else if (
      lower.includes("bunny") ||
      lower.includes("hopper") ||
      lower.includes("hopping") ||
      lower.includes("furry") ||
      lower.includes("rabbit")
    ) {
      file = "bunny";
    }

    if (file && !sequence.includes(file)) {
      sequence.push(file);
    }
  }

  return sequence;
}

function guessExtension(baseName) {
  const knownFiles = {
    rose: ".gif", dog: ".jpeg", swan: ".jpeg", bunny: ".mp4",
    flamingo: ".jpeg", flicker: ".jpeg", parrot: ".jpeg", cardinal: ".jpeg",
    deer: ".png", callalily: ".gif", canna: ".gif", cherryblossom: ".gif",
    bleedingheart: ".gif", planet: ".mov",
  };
  return knownFiles[baseName.toLowerCase()] || "";
}

function handleError(err) {
  if (err.code === "ECONNREFUSED") {
    console.log("ERROR: Connection refused - server is not running");
  } else if (err.code === "ENOTFOUND") {
    console.log("ERROR: Server host not found");
  } else if (err.code === "ETIMEDOUT") {
    console.log("ERROR: Connection timed out");
  } else if (err.code === "ECONNRESET") {
    console.log("ERROR: Connection reset by server");
  } else {
    console.log("ERROR:", err.message);
  }
}

// ============================================================
// Parse command line arguments
// ============================================================

let args = process.argv.slice(2);
let serverIP, serverPort, fileName, version = 11, requestType = "query";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-s") {
    let serverInfo = args[i + 1].split(":");
    serverIP = serverInfo[0];
    serverPort = parseInt(serverInfo[1]);
  } else if (args[i] === "-q") {
    fileName = args[i + 1];
  } else if (args[i] === "-v") {
    version = parseInt(args[i + 1]);
  } else if (args[i] === "--type") {
    requestType = args[i + 1];
  }
}

console.log("Connecting to:", serverIP + ":" + serverPort);
console.log("Request type:", requestType);
console.log("MTP Version:", version);

// Map string type to numeric
let requestTypeNum = 1;
if (requestType === "secret") requestTypeNum = 2;
else if (requestType === "reset") requestTypeNum = 3;
else if (requestType === "ack") requestTypeNum = 4;
else if (requestType === "complete") requestTypeNum = 5;

// ============================================================
// Dispatch based on mode
// ============================================================

if (requestTypeNum === 1) {
  console.log("Requesting file:", fileName);
  runQueryMode();
} else if (requestTypeNum === 2) {
  runSecretMode();
} else {
  console.log("Unsupported standalone request type:", requestType);
  process.exit(1);
}

// ============================================================
// QUERY MODE - Original single-request flow
// ============================================================
function runQueryMode() {
  let client = new net.Socket();
  let receivedData = Buffer.alloc(0);
  let headerReceived = false;
  let packetMap = {};
  let nextExpectedSeq = 0;
  let fileComplete = false;
  let connectionTimeout, transferTimeout;

  connectionTimeout = setTimeout(() => {
    console.log("ERROR: Connection timeout");
    client.destroy();
  }, 10000);

  client.connect(serverPort, serverIP, () => {
    console.log("Connected to server");
    clearTimeout(connectionTimeout);

    let fileNameParts = fileName.split(".");
    let fileNameOnly = fileNameParts[0];
    let mediaType = getMediaType(fileName);

    let packet = createRequestPacket(version, 1, mediaType, fileNameOnly);

    console.log("Request packet:");
    printPacketBit(packet);
    client.write(packet);
  });

  client.on("data", (data) => {
    receivedData = Buffer.concat([receivedData, data]);
    let processedBytes = 0;

    while (receivedData.length - processedBytes >= 12) {
      const packetStart = processedBytes;
      const headerBuf = receivedData.slice(packetStart, packetStart + 12);

      let responseVersion = parseBitPacket(headerBuf, 0, 5);
      let responseType = parseBitPacket(headerBuf, 5, 3);
      let sequenceNumber = parseBitPacket(headerBuf, 8, 24);
      let lastPacketFlag = parseBitPacket(headerBuf, 64, 1);
      let payloadSize = parseBitPacket(headerBuf, 65, 31);

      if (receivedData.length - packetStart < 12 + payloadSize) break;

      let payload = receivedData.slice(
        packetStart + 12,
        packetStart + 12 + payloadSize
      );

      console.log(
        "Received packet " +
          (sequenceNumber + 1) +
          ": " +
          payloadSize +
          " bytes (Last=" +
          lastPacketFlag +
          ")"
      );

      if (!headerReceived) {
        headerReceived = true;
        transferTimeout = setTimeout(() => {
          console.log("ERROR: Transfer timeout");
          client.destroy();
        }, 30000);

        console.log(
          "Response Type:",
          responseType,
          responseType === 1
            ? "(Found)"
            : responseType === 2
              ? "(Not Found)"
              : responseType === 3
                ? "(Busy)"
                : "(Other)"
        );

        if (responseType === 2) {
          console.log("File not found on server");
          clearTimeout(transferTimeout);
          client.destroy();
          return;
        }
        if (responseType === 3) {
          console.log("Server is busy or version mismatch");
          clearTimeout(transferTimeout);
          client.destroy();
          return;
        }
      }

      packetMap[sequenceNumber] = payload;
      nextExpectedSeq++;
      processedBytes = packetStart + 12 + payloadSize;

      if (lastPacketFlag === 1) {
        fileComplete = true;
        break;
      }
    }

    if (processedBytes > 0) {
      receivedData = receivedData.slice(processedBytes);
    }

    if (fileComplete) {
      clearTimeout(transferTimeout);

      let fileData = Buffer.alloc(0);
      for (let i = 0; i < nextExpectedSeq; i++) {
        fileData = Buffer.concat([fileData, packetMap[i]]);
      }

      console.log("File received:", fileData.length, "bytes");

      const mediaFolder = "media";
      fs.mkdir(mediaFolder, { recursive: true }, (err) => {
        if (err) {
          console.log("Error creating media folder:", err);
          client.destroy();
          return;
        }

        let outputFileName = mediaFolder + "/downloaded_" + fileName;
        fs.writeFile(outputFileName, fileData, (err) => {
          if (err) {
            console.log("Error saving file:", err);
            client.destroy();
            return;
          }

          console.log("File saved as:", outputFileName);
          open(outputFileName)
            .then(() => {
              console.log("File opened!");
              client.destroy();
            })
            .catch((err) => {
              console.log("Could not auto-open:", err.message);
              client.destroy();
            });
        });
      });
    }
  });

  client.on("error", handleError);
  client.on("close", () => {
    console.log("Connection closed");
    clearTimeout(connectionTimeout);
    clearTimeout(transferTimeout);
  });
}

// ============================================================
// SECRET MODE - Multi-step secret session flow
// ============================================================
function runSecretMode() {
  let client = new net.Socket();
  let receivedData = Buffer.alloc(0);
  let connectionTimeout, transferTimeout;

  // Secret session state
  let state = "WAIT_RIDDLE";
  let fileSequence = [];
  let currentFileIndex = 0;
  let keyParts = [];
  let packetMap = {};
  let nextExpectedSeq = 0;
  let currentFileName = "";

  connectionTimeout = setTimeout(() => {
    console.log("ERROR: Connection timeout");
    client.destroy();
  }, 10000);

  client.connect(serverPort, serverIP, () => {
    console.log("Connected to server");
    clearTimeout(connectionTimeout);

    transferTimeout = setTimeout(() => {
      console.log("ERROR: Secret session timeout");
      client.destroy();
    }, 60000);

    // Send Secret request (type 2)
    let packet = createRequestPacket(version, 2, 0, "secret");
    console.log("Sending Secret request (type 2)");
    printPacketBit(packet);
    client.write(packet);
  });

  client.on("data", (data) => {
    receivedData = Buffer.concat([receivedData, data]);
    processBuffer();
  });

  function processBuffer() {
    while (receivedData.length >= 12) {
      let headerBuf = receivedData.slice(0, 12);
      let responseType = parseBitPacket(headerBuf, 5, 3);
      let sequenceNumber = parseBitPacket(headerBuf, 8, 24);
      let lastPacketFlag = parseBitPacket(headerBuf, 64, 1);
      let payloadSize = parseBitPacket(headerBuf, 65, 31);

      if (receivedData.length < 12 + payloadSize) return; // Incomplete

      let payload = receivedData.slice(12, 12 + payloadSize);
      receivedData = receivedData.slice(12 + payloadSize);

      // Handle based on response type and state
      if (responseType === 4) {
        // Secret message
        let secretFlag = parseBitPacket(headerBuf, 32, 3);
        let keyPartIndex = parseBitPacket(headerBuf, 35, 2);
        let payloadStr = payload.toString();
        handleSecretResponse(secretFlag, keyPartIndex, payloadStr, client);
      } else if (responseType === 1 && state === "WAIT_FILE") {
        // File data packet
        packetMap[sequenceNumber] = payload;
        nextExpectedSeq = sequenceNumber + 1;

        console.log(
          "File packet " +
            (sequenceNumber + 1) +
            ": " +
            payloadSize +
            " bytes (Last=" +
            lastPacketFlag +
            ")"
        );

        if (lastPacketFlag === 1) {
          // Reassemble and save file
          let fileData = Buffer.alloc(0);
          for (let i = 0; i < nextExpectedSeq; i++) {
            fileData = Buffer.concat([fileData, packetMap[i]]);
          }

          console.log("File received:", fileData.length, "bytes");

          // Save file
          let ext = guessExtension(currentFileName);
          let outName = "media/downloaded_" + currentFileName + ext;
          fs.mkdirSync("media", { recursive: true });
          fs.writeFileSync(outName, fileData);
          console.log("Saved:", outName);

          // Reset for next file
          packetMap = {};
          nextExpectedSeq = 0;

          // Now wait for key part
          state = "WAIT_KEY_PART";
          console.log("Waiting for key part...");
        }
      } else if (responseType === 2) {
        console.log("File not found!");
        clearTimeout(transferTimeout);
        client.destroy();
        return;
      } else if (responseType === 3) {
        console.log("Server busy or version mismatch!");
        clearTimeout(transferTimeout);
        client.destroy();
        return;
      }
    }
  }

  function handleSecretResponse(flag, keyPartIndex, payloadStr, client) {
    console.log(
      "Secret response: flag=" + flag + ", payload=" + payloadStr.substring(0, 80)
    );

    switch (flag) {
      case 1: // Riddle
        if (state !== "WAIT_RIDDLE") {
          console.log("Unexpected riddle in state:", state);
          break;
        }
        console.log("\n=== RIDDLE ===");
        console.log(payloadStr);
        console.log("==============\n");

        fileSequence = parseRiddleSequence(payloadStr);
        console.log("Detected file sequence:", fileSequence);

        if (fileSequence.length !== 3) {
          console.log("ERROR: Could not determine 3 files from riddle");
          client.destroy();
          return;
        }

        // Send first file query
        currentFileIndex = 0;
        sendNextFileQuery(client);
        break;

      case 2: // Key Part
        if (state !== "WAIT_KEY_PART") {
          console.log("Unexpected key part in state:", state);
          break;
        }
        console.log("Received key part " + keyPartIndex + ": " + payloadStr);
        keyParts[keyPartIndex] = payloadStr;

        // Send ACK
        let ackPacket = createRequestPacket(
          version,
          4,
          0,
          String(keyPartIndex)
        );
        console.log("Sending ACK for key part " + keyPartIndex);
        client.write(ackPacket);
        state = "WAIT_ACK_RECEIPT";
        break;

      case 3: // Ack Receipt
        if (state !== "WAIT_ACK_RECEIPT") {
          console.log("Unexpected ack receipt in state:", state);
          break;
        }
        console.log("Ack receipt received");

        currentFileIndex++;
        if (currentFileIndex < 3) {
          // Send next file query
          sendNextFileQuery(client);
        } else {
          // All files done, send Complete
          let completePacket = createRequestPacket(
            version,
            5,
            0,
            "complete"
          );
          console.log("Sending Complete request (type 5)");
          client.write(completePacket);
          state = "WAIT_SECRET";
        }
        break;

      case 4: // Encrypted Secret
        if (state !== "WAIT_SECRET") {
          console.log("Unexpected secret in state:", state);
          break;
        }
        console.log("\n=== ENCRYPTED SECRET ===");
        console.log(payloadStr);

        // Reconstruct key from parts
        let fullKey = keyParts.join("");
        console.log("Reconstructed key:", fullKey);

        // Decrypt
        let decrypted = VigenereCipher.decrypt(payloadStr, fullKey);
        console.log("\n=== DECRYPTED SECRET ===");
        console.log(decrypted);
        console.log("========================\n");

        clearTimeout(transferTimeout);
        client.destroy();
        break;

      case 5: // Error / Expired
        console.log("Server error:", payloadStr);
        clearTimeout(transferTimeout);
        client.destroy();
        break;
    }
  }

  function sendNextFileQuery(client) {
    currentFileName = fileSequence[currentFileIndex];
    console.log(
      "Requesting file " +
        (currentFileIndex + 1) +
        "/3: " +
        currentFileName
    );

    let packet = createRequestPacket(version, 1, 0, currentFileName);
    client.write(packet);
    state = "WAIT_FILE";
    packetMap = {};
    nextExpectedSeq = 0;
  }
 
  client.on("error", handleError);
  client.on("close", () => {
    console.log("Connection closed");
    clearTimeout(connectionTimeout);
    clearTimeout(transferTimeout);
  });
}
