// SecretVariants.js - 3 time-rotating secret variants (300s windows)

let VigenereCipher = require('./VigenereCipher');

const TIME_WINDOW = 300; // 300 seconds = 5 minutes

const variants = [
  {
    key: "SecretKey123!!",
    riddle: "First, find the flower that symbolizes love. Then, seek man's best friend. Finally, glide across the lake with grace.",
    sequence: ["Rose", "Dog", "Swan"],
    secret: "The ancient password is hidden in the stars above us"
  },
  {
    key: "EncryptPass456!",
    riddle: "Begin with the elegant bird on the lake. Next, pick the flower of romance. End with the hopping creature in the meadow.",
    sequence: ["Swan", "Rose", "bunny"],
    secret: "Knowledge is the key that unlocks every door in life"
  },
  {
    key: "MysteryCode7890",
    riddle: "Start with the furry hopper. Then, watch the graceful bird. Finish with the thorny bloom.",
    sequence: ["bunny", "Swan", "Rose"],
    secret: "In the depths of silence one discovers true wisdom here"
  }
];

// Pre-encrypt secrets on module load
for (let v of variants) {
  v.encryptedSecret = VigenereCipher.encrypt(v.secret, v.key);
}

function getCurrentVariantIndex() {
  return Math.floor(Date.now() / 1000 / TIME_WINDOW) % 3;
}

function getCurrentVariant() {
  return variants[getCurrentVariantIndex()];
}

function getVariant(index) {
  return variants[index];
}

module.exports = { getCurrentVariant, getCurrentVariantIndex, getVariant, TIME_WINDOW };
