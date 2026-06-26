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

// ================= APP SETUP =================
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

// ================= AUTH =================
async function authenticateUser(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      return res.status(401).json({ success: false, error: "No token provided" });
    }

    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("🚀 UrjaRise Backend Running");
});

// ================= CARD SYSTEM =================
const CARD_POOL = [
  { id: "c1", name: "Morning Spark", emoji: "🌅", rarity: "Common", description: "Waking up on time builds momentum." },
  { id: "c2", name: "Tiny Wins", emoji: "🌱", rarity: "Common", description: "Small consistent gains lead to massive results." },
  { id: "c3", name: "Focus Seed", emoji: "🌰", rarity: "Common", description: "Plant a thought, reap habits." },

  { id: "u1", name: "Healthy Habit", emoji: "🥗", rarity: "Uncommon", description: "Better fuel = better output." },
  { id: "u2", name: "Early Bird", emoji: "🦅", rarity: "Uncommon", description: "Morning control wins the day." },

  { id: "r1", name: "Focus Warrior", emoji: "⚔️", rarity: "Rare", description: "Deep work shield." },
  { id: "r2", name: "Consistency Engine", emoji: "🚂", rarity: "Rare", description: "Never stops moving." },

  { id: "e1", name: "Iron Discipline", emoji: "🛡️", rarity: "Epic", description: "Unbreakable focus." },
  { id: "e2", name: "Zen Master", emoji: "🧘", rarity: "Epic", description: "Calm control." },

  { id: "l1", name: "Time Master", emoji: "⏳", rarity: "Legendary", description: "Bends time." },
  { id: "l2", name: "Limit Breaker", emoji: "💥", rarity: "Legendary", description: "Breaks limits." },

  { id: "m1", name: "Dragon Discipline", emoji: "🐉", rarity: "Mythical", description: "Power unleashed." },
  { id: "m2", name: "Infinite Focus", emoji: "🌌", rarity: "Mythical", description: "Endless flow." },

  { id: "d1", name: "Cosmic Growth", emoji: "🪐", rarity: "Divine", description: "Universal evolution." },
];

// ================= CHANCES =================
const PACK_CHANCES = {
  basic: { Common: 0.7, Uncommon: 0.25, Rare: 0.05 },
  growth: { Common: 0.4, Uncommon: 0.35, Rare: 0.2, Epic: 0.05 },
  discipline: { Uncommon: 0.4, Rare: 0.4, Epic: 0.18, Legendary: 0.02 },
  legendary: { Rare: 0.45, Epic: 0.35, Legendary: 0.18, Mythical: 0.02 },
  mythical: { Epic: 0.5, Legendary: 0.4, Mythical: 0.09, Divine: 0.01 },
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

function pickCard(rarities) {
  const pool = CARD_POOL.filter(c => rarities.includes(c.rarity));
  return { ...pool[Math.floor(Math.random() * pool.length)] };
}

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
    let dust = 0;
    let cardsPulled = [];

    const chances = PACK_CHANCES[packId];

    // ================= CARD GENERATION =================
    for (let i = 0; i < pack.cards; i++) {
      const rarity = rollRarity(chances);
      cardsPulled.push(pickCard([rarity]));
    }

    // ================= TRANSACTION =================
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        throw new Error("User not found");
      }

      const user = userSnap.data();

      const currentUP = user.urjaPoints || 0;
      let currentDust = user.cardDust || 0;

      if (currentUP < pack.price) {
        throw new Error("Not enough UP");
      }

      remainingUP = currentUP - pack.price;

      // ================= READ FIRST =================
      const cardSnapshots = [];

      for (const card of cardsPulled) {
        const cardRef = userRef.collection("cards").doc(card.id);
        const snap = await tx.get(cardRef);

        cardSnapshots.push({ card, snap, ref: cardRef });
      }

      // ================= WRITE AFTER =================
      for (const item of cardSnapshots) {
        const { card, snap, ref } = item;

        if (snap.exists) {
          card.isDuplicate = true;
          card.dustReward = 5;
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
            description: card.description,
            quantity: 1,
            acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
            source: `store_pack_${packId}`,
            originalOwner: req.user.uid,
          });
        }
      }

      currentDust = currentDust;

      tx.update(userRef, {
        urjaPoints: remainingUP,
        cardDust: currentDust,
      });

      dust = currentDust;
    });

    res.json({
      success: true,
      remainingUP,
      remainingDust: dust,
      cardsPulled,
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
