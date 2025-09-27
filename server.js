import axios from "axios";
import express from "express";
import http from "http";
import https from "https";

const app = express();
const PORT = 4000;

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
];

function getRandomUA() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

const axiosInstance = axios.create({
  timeout: 5000,
  maxRedirects: 3,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
});

class RateLimiter {
  constructor(maxConcurrent = 20, delayMs = 50) {
    this.maxConcurrent = maxConcurrent;
    this.delayMs = delayMs;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;

    this.running++;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      setTimeout(() => this.process(), this.delayMs);
    }
  }
}

const rateLimiter = new RateLimiter(20, 30);

// --- Fetch match details ---
async function fetchMatchDetails(matchId) {
  return rateLimiter.add(async () => {
    try {
      const headers = {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "user-agent": getRandomUA(),
        "x-mas": "eyJib2R5Ijp7InVybCI6Ii9hcGkvZGF0YS9tYXRjaERldGFpbHM/bWF0Y2hJZD00ODEzNDI2IiwiY29kZSI6MTc1ODk3NzI4NjIyMiwiZm9vIjoicHJvZHVjdGlvbjpkYjQ1NGEwZmNmMTkzNTA2N2ZiYTI1YjQwYWNmMjU1NDVkZjRlMTJjIn0sInNpZ25hdHVyZSI6IkI2NDkzMTYyNkUxMUQyRTcxOThDOTIwMThBRUZBRUY4In0=",
        Referer: "https://www.fotmob.com",
        Connection: "keep-alive",
      };

      const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`;
      const response = await axiosInstance.get(url, { headers });
      return { matchId, data: response.data.content.matchFacts?.infoBox || null };
    } catch (error) {
      console.error(`Error fetching match details for ID ${matchId}:`, error.message);
      return { matchId, data: null };
    }
  });
}

// --- Batch fetch ---
async function fetchMatchDetailsBatch(matchIds) {
  const promises = matchIds.map((id) => fetchMatchDetails(id));
  const results = await Promise.allSettled(promises);
  const detailsMap = new Map();

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const { matchId, data } = result.value;
      detailsMap.set(matchId, data);
    } else {
      detailsMap.set(matchIds[index], null);
    }
  });

  return matchIds.map((id) => detailsMap.get(id));
}

// --- Cache ---
const matchDetailsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchMatchDetailsWithCache(matchId) {
  const now = Date.now();
  const cached = matchDetailsCache.get(matchId);

  if (cached && now - cached.timestamp < CACHE_TTL) return { matchId, data: cached.data };

  const result = await fetchMatchDetails(matchId);
  matchDetailsCache.set(matchId, { data: result.data, timestamp: now });
  return result;
}

async function fetchMatchDetailsBatchCached(matchIds) {
  const promises = matchIds.map((id) => fetchMatchDetailsWithCache(id));
  const results = await Promise.allSettled(promises);
  const detailsMap = new Map();

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const { matchId, data } = result.value;
      detailsMap.set(matchId, data);
    } else {
      detailsMap.set(matchIds[index], null);
    }
  });

  return matchIds.map((id) => detailsMap.get(id));
}

// --- Fetch sport data ---
async function fetchSportData(compactDate, includeDetails, useCache = true) {
  const headers = {
    "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "user-agent": getRandomUA(),
    "x-mas": "eyJib2R5Ijp7InVybCI6Ii9hcGkvZGF0YS9tYXRjaGVzP2RhdGU9MjAyNTA5MjcmdGltZXpvbmU9QWZyaWNhJTJGTGFnb3MmY2NvZGUzPU5HQSIsImNvZGUiOjE3NTg5NzUxNzYxNDEsImZvbyI6InByb2R1Y3Rpb246ZGI0NTRhMGZjZjE5MzUwNjdmYmEyNWI0MGFjZjI1NTQ1ZGY0ZTEyYyJ9LCJzaWduYXR1cmUiOiI2QjUyREU3NkZCQjU3OUFBRkZBMTIxMjBERjNDMEQyMiJ9",
    Referer: "https://www.fotmob.com/",
    Connection: "keep-alive",
  };

  const response = await axiosInstance.get(
    `https://www.fotmob.com/api/data/matches?date=${compactDate}&timezone=Africa%2FLagos&ccode3=NGA`,
    { headers }
  );

  const allMatchIds = [];
  const leagueMatchMap = new Map();

  response.data.leagues.forEach((league, leagueIndex) => {
    const matchIds = league.matches.map((m) => m.id);
    leagueMatchMap.set(leagueIndex, matchIds);
    allMatchIds.push(...matchIds);
  });

  let allMatchDetails = [];
  if (includeDetails && allMatchIds.length > 0) {
    const detailsStart = Date.now();
    allMatchDetails = useCache
      ? await fetchMatchDetailsBatchCached(allMatchIds)
      : await fetchMatchDetailsBatch(allMatchIds);
    console.log(`Match details fetched in ${Date.now() - detailsStart}ms`);
  }

  let detailsIndex = 0;
  const leaguesWithLogos = response.data.leagues.map((league, leagueIndex) => {
    const matchIds = leagueMatchMap.get(leagueIndex);
    const leagueDetails = includeDetails ? allMatchDetails.slice(detailsIndex, detailsIndex + matchIds.length) : [];
    detailsIndex += matchIds.length;

    const matchesWithExtras = league.matches.map((match, matchIndex) => ({
      ...match,
      home: { ...match.home, logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${match.home.id}_small.png` },
      away: { ...match.away, logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${match.away.id}_small.png` },
      details: includeDetails ? leagueDetails[matchIndex] : null,
    }));

    return { ...league, logo: `https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${league.id}.png`, matches: matchesWithExtras };
  });

  return { leagues: leaguesWithLogos };
}

// --- Routes ---
app.get("/sport/scheduled-events", async (req, res) => {
  const date = req.query.date;
  const sport = req.query.type;
  const includeDetails = req.query.details === "true";
  const useCache = req.query.cache !== "false";

  if (sport !== "football") return res.status(400).json({ error: "Only football is supported" });

  try {
    const compactDate = date.replace(/-/g, "");
    const startTime = Date.now();

    const data = await fetchSportData(compactDate, includeDetails, useCache);

    const duration = Date.now() - startTime;
    console.log(`Request completed in ${duration}ms`);

    return res.json({
      status: "success",
      date: compactDate,
      includeDetails,
      duration: `${duration}ms`,
      data,
    });
  } catch (error) {
    console.error("API error:", error.message);
    return res.status(500).json({ error: "Failed to fetch sport data" });
  }
});

// --- Cleanup cache periodically ---
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of matchDetailsCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) matchDetailsCache.delete(key);
  }
}, CACHE_TTL);

// --- Graceful shutdown ---
process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  process.exit(0);
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Optimized Football addon running on http://localhost:${PORT}`);
  console.log(`Features: Connection pooling, rate limiting, caching, concurrent requests`);
});
