require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ================= DEBUG (REMOVE LATER IF YOU WANT) =================
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

// ================= AUTH MIDDLEWARE =================
async function authenticateUser(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided",
      });
    }

    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Invalid token",
    });
  }
}

// ================= ROUTES =================

// Health check
app.get("/", (req, res) => {
  res.send("🚀 UrjaRise Backend Running");
});

// Verify user
app.post("/verify-user", async (req, res) => {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided",
      });
    }

    const decoded = await auth.verifyIdToken(token);

    res.json({
      success: true,
      uid: decoded.uid,
      email: decoded.email,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message,
    });
  }
});

// Test user
app.get("/test-user", async (req, res) => {
  try {
    const doc = await db
      .collection("users")
      .doc("6onXNtDWnwb6IZJDHGaUh0R4mhB2")
      .get();

    res.json(doc.data());
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get current user
app.get("/me", authenticateUser, async (req, res) => {
  try {
    const userDoc = await db.collection("users").doc(req.user.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      user: userDoc.data(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================= CARD CATALOG & PROBABILITIES =================
const CARD_POOL = [
    { id: "c1", name: "Morning Spark", emoji: "🌅", rarity: "Common", description: "Waking up on time builds immediate momentum." },
    { id: "c2", name: "Tiny Wins", emoji: "🌱", rarity: "Common", description: "Small consistent gains lead to massive results." },
    { id: "c3", name: "Focus Seed", emoji: "🌰", rarity: "Common", description: "Plant a thought, reap a consistent lifestyle habit." },
    { id: "u1", name: "Healthy Habit", emoji: "🥗", rarity: "Uncommon", description: "Fueling the machine correctly creates high output." },
    { id: "u2", name: "Early Bird", emoji: "🦅", rarity: "Uncommon", description: "Capturing control over the morning schedule." },
    { id: "r1", name: "Focus Warrior", emoji: "⚔️", rarity: "Rare", description: "Shielding deep work against casual external distraction items." },
    { id: "r2", name: "Consistency Engine", emoji: "🚂", rarity: "Rare", description: "Moving forward regardless of unstable motivation trends." },
    { id: "e1", name: "Iron Discipline", emoji: "🛡️", rarity: "Epic", description: "Uncompromising loyalty to your primary execution targets." },
    { id: "e2", name: "Zen Master", emoji: "🧘", rarity: "Epic", description: "Absolute structural clarity amid chaos." },
    { id: "l1", name: "Time Master", emoji: "⏳", rarity: "Legendary", description: "Bending schedules to fit peak optimal productivity outputs." },
    { id: "l2", name: "Limit Breaker", emoji: "💥", rarity: "Legendary", description: "Surpassing old boundaries to form a new standard definition." },
    { id: "m1", name: "Dragon Discipline", emoji: "🐉", rarity: "Mythical", description: "Ferocious, unstoppable execution power that dominates tasks." },
    { id: "m2", name: "Infinite Focus", emoji: "🌌", rarity: "Mythical", description: "Entering a pure deep work flow state where hours feel like minutes." },
    { id: "d1", name: "Cosmic Growth", emoji: "🪐", rarity: "Divine", description: "Exponential evolution across all sectors of human discipline." }
];

const PACK_CHANCES = {
  basic: { Common: 0.70, Uncommon: 0.25, Rare: 0.05 },
  growth: { Common: 0.40, Uncommon: 0.35, Rare: 0.20, Epic: 0.05 },
  discipline: { Uncommon: 0.40, Rare: 0.40, Epic: 0.18, Legendary: 0.02 },
  legendary: { Rare: 0.45, Epic: 0.35, Legendary: 0.18, Mythical: 0.02 },
  mythical: { Epic: 0.50, Legendary: 0.40, Mythical: 0.09, Divine: 0.01 }
};

const DUST_VALUES = {
  Common: 5, Uncommon: 10, Rare: 25, Epic: 50, Legendary: 150, Mythical: 500, Divine: 2000
};

const GUARANTEED_FILTERS = {
  legendary: ["Epic", "Legendary", "Mythical"],
  mythical: ["Legendary", "Mythical", "Divine"]
};

// Helper function to pick card rarity
function rollRarity(chances) {
  const rand = Math.random();
  let weight = 0;
  for (const [rarity, prob] of Object.entries(chances)) {
    weight += prob;
    if (rand <= weight) return rarity;
  }
  return Object.keys(chances)[0];
}

// Helper function to extract card data
function pickCard(rarities) {
  const pool = CARD_POOL.filter(c => rarities.includes(c.rarity));
  const selection = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : CARD_POOL[0];
  return { ...selection };
}

// ================= SECURED BUY PACK ROUTE =================
app.post("/buyPack", authenticateUser, async (req, res) => {
  try {
    const { packId } = req.body;
    const pack = PACKS[packId];

    if (!pack) {
      return res.status(400).json({ success: false, error: "Invalid pack category parameter." });
    }

    const userRef = db.collection("users").doc(req.user.uid);
    let remainingUP = 0;
    let finalDustTotal = 0;
    let cardsPulled = [];

    // Calculate card awards safely on backend space
    const chances = PACK_CHANCES[packId];
    const guaranteed = GUARANTEED_FILTERS[packId];
    let metGuaranteed = !guaranteed;

    for (let i = 0; i < pack.cards; i++) {
      if (i === pack.cards - 1 && !metGuaranteed) {
        cardsPulled.push(pickCard(guaranteed));
        continue;
      }
      const chosenRarity = rollRarity(chances);
      if (guaranteed && guaranteed.includes(chosenRarity)) {
        metGuaranteed = true;
      }
      cardsPulled.push(pickCard([chosenRarity]));
    }

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new Error("User record context missing");
      }

      const userData = userDoc.data();
      const currentUP = userData.urjaPoints || 0;
      let currentDust = userData.cardDust || 0;

      if (currentUP < pack.price) {
        throw new Error("Not enough Urja Points (UP)");
      }

      remainingUP = currentUP - pack.price;

      // Process subcollection card updates inside the transaction scope
      for (const card of cardsPulled) {
        const cardRef = userRef.collection("cards").doc(card.id);
        const cardDoc = await transaction.get(cardRef);

        if (cardDoc.exists) {
          card.isDuplicate = true;
          card.dustReward = DUST_VALUES[card.rarity] || 5;
          currentDust += card.dustReward;

          transaction.update(cardRef, {
            quantity: (cardDoc.data().quantity || 1) + 1,
            lastAcquiredAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          card.isDuplicate = false;
          transaction.set(cardRef, {
            id: card.id,
            name: card.name,
            emoji: card.emoji,
            rarity: card.rarity,
            description: card.description,
            quantity: 1,
            acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
            source: `store_pack_${packId}`,
            originalOwner: req.user.uid
          });
        }
      }

      finalDustTotal = currentDust;

      transaction.update(userRef, {
        urjaPoints: remainingUP,
        cardDust: finalDustTotal
      });
    });

    res.json({
      success: true,
      remainingUP,
      remainingDust: finalDustTotal,
      cardsPulled
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
