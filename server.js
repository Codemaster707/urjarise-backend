require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ================= DEBUG =================
console.log("PROJECT:", process.env.FIREBASE_PROJECT_ID);
console.log("EMAIL:", process.env.FIREBASE_CLIENT_EMAIL);
console.log("KEY exists:", !!process.env.FIREBASE_PRIVATE_KEY);

// ================= VALIDATION =================
if (
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY
) {
  throw new Error("Missing Firebase environment variables");
}

// ================= FIREBASE INIT =================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();
const auth = admin.auth();

// ================= APP =================
const app = express();
app.use(cors());
app.use(express.json());

// ================= PACKS =================
const PACKS = {
  basic: { price: 40, cards: 1 },
  growth: { price: 100, cards: 2 },
  discipline: { price: 200, cards: 3 },
  legendary: { price: 500, cards: 5 },
  mythical: { price: 1500, cards: 10 },
};

// ================= CARD POOL =================
const CARD_POOL = [
  { id: "c1", name: "Morning Spark", emoji: "🌅", rarity: "Common" },
  { id: "c2", name: "Tiny Wins", emoji: "🌱", rarity: "Common" },
  { id: "c3", name: "Focus Seed", emoji: "🌰", rarity: "Common" },

  { id: "u1", name: "Healthy Habit", emoji: "🥗", rarity: "Uncommon" },
  { id: "u2", name: "Early Bird", emoji: "🦅", rarity: "Uncommon" },

  { id: "r1", name: "Focus Warrior", emoji: "⚔️", rarity: "Rare" },
  { id: "r2", name: "Consistency Engine", emoji: "🚂", rarity: "Rare" },

  { id: "e1", name: "Iron Discipline", emoji: "🛡️", rarity: "Epic" },
  { id: "e2", name: "Zen Master", emoji: "🧘", rarity: "Epic" },

  { id: "l1", name: "Time Master", emoji: "⏳", rarity: "Legendary" },
  { id: "l2", name: "Limit Breaker", emoji: "💥", rarity: "Legendary" },

  { id: "m1", name: "Dragon Discipline", emoji: "🐉", rarity: "Mythical" },
  { id: "m2", name: "Infinite Focus", emoji: "🌌", rarity: "Mythical" },

  { id: "d1", name: "Cosmic Growth", emoji: "🪐", rarity: "Divine" },
];

// ================= CHANCES =================
const PACK_CHANCES = {
  basic: { Common: 0.7, Uncommon: 0.25, Rare: 0.05 },
  growth: { Common: 0.4, Uncommon: 0.35, Rare: 0.2, Epic: 0.05 },
  discipline: { Uncommon: 0.4, Rare: 0.4, Epic: 0.18, Legendary: 0.02 },
  legendary: { Rare: 0.45, Epic: 0.35, Legendary: 0.18, Mythical: 0.02 },
  mythical: { Epic: 0.5, Legendary: 0.4, Mythical: 0.09, Divine: 0.01 },
};

const GUARANTEED = {
  legendary: ["Epic", "Legendary", "Mythical"],
  mythical: ["Legendary", "Mythical", "Divine"],
};

const DUST_VALUES = {
  Common: 5,
  Uncommon: 10,
  Rare: 25,
  Epic: 50,
  Legendary: 150,
  Mythical: 500,
  Divine: 2000,
};

// ================= HELPERS =================
function rollRarity(chances) {
  const r = Math.random();
  let sum = 0;

  for (const [rarity, p] of Object.entries(chances)) {
    sum += p;
    if (r <= sum) return rarity;
  }

  return Object.keys(chances)[0];
}

function pickCard(rarityList) {
  const pool = CARD_POOL.filter(c => rarityList.includes(c.rarity));
  return { ...pool[Math.floor(Math.random() * pool.length)] };
}

// ================= AUTH =================
async function authenticateUser(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) {
      return res.status(401).json({ success: false, error: "No token" });
    }

    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send("🚀 UrjaRise Backend Running");
});

// ================= BUY PACK =================
app.post("/buyPack", authenticateUser, async (req, res) => {
  try {
    const { packId } = req.body;
    const pack = PACKS[packId];

    if (!pack) {
      return res.status(400).json({ success: false, error: "Invalid pack" });
    }

    const userRef = db.collection("users").doc(req.user.uid);

    let remainingUP = 0;
    let finalDust = 0;
    let cardsPulled = [];

    const chances = PACK_CHANCES[packId];
    const guaranteed = GUARANTEED[packId];

    let metGuarantee = false;

    // ================= CARD GENERATION =================
    for (let i = 0; i < pack.cards; i++) {
      let rarity = rollRarity(chances);

      if (guaranteed && guaranteed.includes(rarity)) {
        metGuarantee = true;
      }

      if (i === pack.cards - 1 && guaranteed && !metGuarantee) {
        rarity = guaranteed[Math.floor(Math.random() * guaranteed.length)];
      }

      cardsPulled.push(pickCard([rarity]));
    }

    // ================= TRANSACTION =================
    await db.runTransaction(async (tx) => {

      // STEP 1: READ USER FIRST
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) throw new Error("User not found");

      const user = userSnap.data();

      const currentUP = user.urjaPoints || 0;
      let currentDust = user.cardDust || 0;

      if (currentUP < pack.price) {
        throw new Error("Not enough UP");
      }

      remainingUP = currentUP - pack.price;

      // STEP 2: READ ALL CARDS FIRST
      const cardOps = [];

      for (const card of cardsPulled) {
        const cardRef = userRef.collection("cards").doc(card.id);
        const snap = await tx.get(cardRef);

        cardOps.push({ card, snap, ref: cardRef });
      }

      // STEP 3: WRITE AFTER READS
      for (const op of cardOps) {
        const { card, snap, ref } = op;

        if (snap.exists) {
          card.isDuplicate = true;
          card.dustReward = DUST_VALUES[card.rarity] || 5;

          currentDust += card.dustReward;

          tx.update(ref, {
            quantity: (snap.data().quantity || 1) + 1,
            lastAcquiredAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          card.isDuplicate = false;

          tx.set(ref, {
            id: card.id,
            name: card.name,
            emoji: card.emoji,
            rarity: card.rarity,
            quantity: 1,
            acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
            source: `pack_${packId}`,
            owner: req.user.uid,
          });
        }
      }

      finalDust = currentDust;

      // UPDATE USER
      tx.update(userRef, {
        urjaPoints: remainingUP,
        cardDust: finalDust,
      });
    });

    // ================= RESPONSE =================
    res.json({
      success: true,
      remainingUP,
      remainingDust: finalDust,
      cardsPulled,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
