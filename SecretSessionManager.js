// SecretSessionManager.js - Per-client session state management

let SecretVariants = require('./SecretVariants');

const sessions = new Map();

const States = {
  RIDDLE_SENT: 'RIDDLE_SENT',
  AWAITING_SEQUENCE: 'AWAITING_SEQUENCE',
  KEY_DISTRIBUTION: 'KEY_DISTRIBUTION',
  COMPLETE: 'COMPLETE'
};

function getClientId(sock) {
  return sock.remoteAddress + ':' + sock.remotePort;
}

function startSession(sock) {
  let clientId = getClientId(sock);
  let variant = SecretVariants.getCurrentVariant();
  let variantIndex = SecretVariants.getCurrentVariantIndex();

  let session = {
    clientId: clientId,
    variantIndex: variantIndex,
    state: States.RIDDLE_SENT,
    sequence: variant.sequence.slice(),
    filesRequested: [],
    nextFileIndex: 0,
    keyParts: splitKey(variant.key),
    nextKeyPartToSend: 0,
    awaitingAck: false,
    keyPartsAcknowledged: 0,
    startTime: Date.now()
  };

  sessions.set(clientId, session);
  return { riddle: variant.riddle, variantIndex: variantIndex };
}

function splitKey(key) {
  let partSize = Math.ceil(key.length / 3);
  return [
    key.slice(0, partSize),
    key.slice(partSize, partSize * 2),
    key.slice(partSize * 2)
  ];
}

function getSession(sock) {
  return sessions.get(getClientId(sock));
}

function isSessionValid(sock) {
  let session = getSession(sock);
  if (!session) return false;

  // Check if the time window has changed
  let currentVariant = SecretVariants.getCurrentVariantIndex();
  if (currentVariant !== session.variantIndex) {
    endSession(sock);
    return false;
  }
  return true;
}

function recordFileRequest(sock, fileName) {
  let session = getSession(sock);
  if (!session) return { valid: false, reason: 'no session' };

  if (session.awaitingAck) {
    return {
      valid: false,
      reason: 'ack required',
      expectedAckPart: session.nextKeyPartToSend
    };
  }

  if (session.nextFileIndex >= session.sequence.length) {
    return { valid: false, reason: 'sequence already complete' };
  }

  let expectedFile = session.sequence[session.nextFileIndex];
  if (fileName.toLowerCase() !== expectedFile.toLowerCase()) {
    return { valid: false, reason: 'wrong file order', expected: expectedFile, got: fileName };
  }

  session.filesRequested.push(fileName);
  session.nextFileIndex++;
  session.state = States.AWAITING_SEQUENCE;

  return { valid: true, fileIndex: session.nextFileIndex - 1 };
}

function getNextKeyPart(sock) {
  let session = getSession(sock);
  if (!session) return null;

  if (session.awaitingAck) {
    return { blocked: true, expectedPartIndex: session.nextKeyPartToSend };
  }

  let index = session.nextKeyPartToSend;
  if (index >= session.keyParts.length) return null;

  let part = session.keyParts[index];
  session.awaitingAck = true;
  session.state = States.KEY_DISTRIBUTION;
  return { part: part, index: index };
}

function acknowledgeKeyPart(sock, partIndex) {
  let session = getSession(sock);
  if (!session) return { valid: false, reason: 'no session' };

  if (!session.awaitingAck) {
    return { valid: false, reason: 'no key part pending' };
  }

  let expectedPartIndex = session.nextKeyPartToSend;
  if (partIndex !== expectedPartIndex) {
    return {
      valid: false,
      reason: 'unexpected key part ack',
      expectedPartIndex: expectedPartIndex
    };
  }

  session.awaitingAck = false;
  session.keyPartsAcknowledged++;
  session.nextKeyPartToSend++;

  if (session.keyPartsAcknowledged >= session.keyParts.length) {
    session.state = States.COMPLETE;
  }

  return { valid: true, partIndex: partIndex };
}

function isReadyForSecret(sock) {
  let session = getSession(sock);
  if (!session) return false;

  return (
    session.nextFileIndex >= session.sequence.length &&
    session.keyPartsAcknowledged >= session.keyParts.length &&
    !session.awaitingAck
  );
}

function getEncryptedSecret(sock) {
  let session = getSession(sock);
  if (!session) return null;

  let variant = SecretVariants.getVariant(session.variantIndex);
  return variant.encryptedSecret;
}

function endSession(sock) {
  let clientId = getClientId(sock);
  sessions.delete(clientId);
}

module.exports = {
  startSession,
  getSession,
  isSessionValid,
  recordFileRequest,
  getNextKeyPart,
  acknowledgeKeyPart,
  isReadyForSecret,
  getEncryptedSecret,
  endSession,
  States
};
