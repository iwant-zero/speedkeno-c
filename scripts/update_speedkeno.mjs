// scripts/update_speedkeno.mjs
// - Update mode: fetch latest results, merge into data/speedkeno_draws.json, write freq to data/speedkeno_freq.json
// - Recommend mode: node scripts/update_speedkeno.mjs --recommend --command "<issue comment body>"

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DRAWS_PATH = path.join(DATA_DIR, "speedkeno_draws.json");
const FREQ_PATH = path.join(DATA_DIR, "speedkeno_freq.json");

// ✅ Primary sources (미러/폴백 구조)
const SRC_API = "https://api.bepick.io/keno/get/"; // 최근 30회차 JSON :contentReference[oaicite:2]{index=2}
const SRC_INTERVAL = "https://bepick.net/game/interval/speedkeno"; // HTML에도 회차/번호/행운/합 표시 :contentReference[oaicite:3]{index=3}

// -------------------- utils --------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowISO() {
  return new Date().toISOString();
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readJsonSafe(p, fallback) {
  try {
    const s = await fs.readFile(p, "utf8");
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

async function writeJsonPretty(p, obj) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function fetchText(url, { timeoutMs = 12000, tries = 2 } = {}) {
  let lastErr;
  for (let t = 1; t <= tries; t++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; speedkeno-updater/1.0; +https://github.com/)",
          "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
          "cache-control": "no-cache",
        },
      });
      const txt = await res.text();
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return txt;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (t < tries) await sleep(600 * t);
    }
  }
  throw lastErr;
}

async function fetchJson(url, { timeoutMs = 12000, tries = 2 } = {}) {
  const txt = await fetchText(url, { timeoutMs, tries });
  // dhlottery 차단 페이지 같은 HTML이 내려오면 JSON 파싱에서 터짐 → 방지
  const trimmed = txt.trim();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("Unauthorized")) {
    throw new Error(`Non-JSON response from ${url} (blocked?)`);
  }
  return JSON.parse(trimmed);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeKey(dateYYYYMMDD, round) {
  return `${dateYYYYMMDD}-${Number(round)}`;
}

// -------------------- parse interval HTML (2nd source) --------------------
function parseIntervalHtml(html) {
  // Extract blocks:
  // line with "YYYY-MM-DD-ROUND"
  // next lines eventually contain "NN,NN,...(22) LUCKY X SUM Y"
  const lines = html.split("\n");
  const out = new Map();

  let curKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // date-round
    const m = line.match(/(\d{4})-(\d{2})-(\d{2})-(\d{1,3})/);
    if (m) {
      const date = `${m[1]}${m[2]}${m[3]}`;
      const round = Number(m[4]);
      curKey = normalizeKey(date, round);
      continue;
    }

    if (curKey) {
      // numbers line example:
      // 47,43,03,...,24 24 C 890 A
      const m2 = line.match(/((?:\d{1,2},){21}\d{1,2})\s+(\d{1,2})\s+[A-Z]\s+(\d{1,4})/);
      if (m2) {
        const nums = m2[1].split(",").map((x) => Number.parseInt(x, 10)).filter((v) => Number.isFinite(v));
        const lucky = Number(m2[2]);
        const sum = Number(m2[3]);
        if (nums.length === 22 && lucky >= 1 && lucky <= 70 && sum > 0) {
          out.set(curKey, { numbers: nums, lucky, sum });
        }
        curKey = null;
      }
    }
  }
  return out;
}

// -------------------- stats --------------------
function makeEmptyFreq() {
  const n = {};
  const l = {};
  for (let i = 1; i <= 70; i++) {
    n[i] = 0;
    l[i] = 0;
  }
  return { numberFreq: n, luckyFreq: l };
}

function computeFreq(draws) {
  const base = makeEmptyFreq();
  let sumMin = Infinity, sumMax = -Infinity, sumTotal = 0;

  const sumDigitFreq = Array.from({ length: 10 }, () => 0);
  const sumOddEven = { odd: 0, even: 0 };
  const sumUnderOver = { under: 0, over: 0 }; // last digit <=4 => under, >=5 => over (표준 규칙)

  for (const d of draws) {
    for (const x of d.numbers) {
      if (x >= 1 && x <= 70) base.numberFreq[x] += 1;
    }
    if (d.lucky >= 1 && d.lucky <= 70) base.luckyFreq[d.lucky] += 1;

    const s = Number(d.sum);
    if (Number.isFinite(s)) {
      sumMin = Math.min(sumMin, s);
      sumMax = Math.max(sumMax, s);
      sumTotal += s;

      const digit = ((s % 10) + 10) % 10;
      sumDigitFreq[digit] += 1;
      if (s % 2 === 0) sumOddEven.even += 1;
      else sumOddEven.odd += 1;
      if (digit <= 4) sumUnderOver.under += 1;
      else sumUnderOver.over += 1;
    }
  }

  const totalDraws = draws.length;
  const sumAvg = totalDraws ? sumTotal / totalDraws : 0;

  const recentWindows = [10, 20, 30];
  const recent = {};
  for (const w of recentWindows) {
    const sub = draws.slice(Math.max(0, draws.length - w));
    recent[w] = computeFreqShallow(sub);
  }

  return {
    updatedAt: nowISO(),
    totalDraws,
    sum: {
      min: totalDraws ? sumMin : 0,
      max: totalDraws ? sumMax : 0,
      avg: sumAvg,
      digitFreq: sumDigitFreq,
      oddEven: sumOddEven,
      underOver: sumUnderOver,
    },
    numberFreq: base.numberFreq,
    luckyFreq: base.luckyFreq,
    recent,
  };
}

function computeFreqShallow(draws) {
  const base = makeEmptyFreq();
  const sumBin = { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 }; // bins for sum game
  for (const d of draws) {
    for (const x of d.numbers) if (x >= 1 && x <= 70) base.numberFreq[x] += 1;
    if (d.lucky >= 1 && d.lucky <= 70) base.luckyFreq[d.lucky] += 1;

    const s = Number(d.sum);
    if (Number.isFinite(s)) {
      const b = sumToBin(s);
      sumBin[b] += 1;
    }
  }
  return { numberFreq: base.numberFreq, luckyFreq: base.luckyFreq, sumBin };
}

// sum bins for "숫자합 게임" (22개 합 기준 대략 500~950대가 많음)
function sumToBin(sum) {
  if (sum <= 649) return "b1";
  if (sum <= 699) return "b2";
  if (sum <= 749) return "b3";
  if (sum <= 799) return "b4";
  if (sum <= 849) return "b5";
  return "b6";
}

function binLabel(bin) {
  switch (bin) {
    case "b1": return "≤649";
    case "b2": return "650~699";
    case "b3": return "700~749";
    case "b4": return "750~799";
    case "b5": return "800~849";
    case "b6": return "≥850";
    default: return bin;
  }
}

// -------------------- deterministic PRNG (no Math.random) --------------------
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function makeXorShift32(seedU32) {
  let x = seedU32 >>> 0;
  return {
    nextU32() {
      // xorshift32
      x ^= (x << 13) >>> 0;
      x ^= (x >>> 17) >>> 0;
      x ^= (x << 5) >>> 0;
      return (x >>> 0);
    },
    nextInt(n) {
      if (n <= 0) return 0;
      return (this.nextU32() % n) >>> 0;
    },
  };
}

function blendScore(allFreq, recentFreq, w01) {
  // Normalize by totals
  let allTotal = 0, recentTotal = 0;
  for (let i = 1; i <= 70; i++) { allTotal += allFreq[i] || 0; recentTotal += recentFreq[i] || 0; }
  const out = {};
  for (let i = 1; i <= 70; i++) {
    const a = allTotal ? (allFreq[i] || 0) / allTotal : 0;
    const r = recentTotal ? (recentFreq[i] || 0) / recentTotal : 0;
    out[i] = (1 - w01) * a + w01 * r;
  }
  return out;
}

function rankByScore(scoreObj) {
  const arr = [];
  for (let i = 1; i <= 70; i++) arr.push(i);
  arr.sort((a, b) => {
    const da = scoreObj[a] ?? 0;
    const db = scoreObj[b] ?? 0;
    if (db !== da) return db - da;
    return a - b;
  });
  return arr;
}

function pickFromBand(bandArr, pickCount, spread01, prng) {
  // spread01: 0..1, 0이면 상단 20%만, 1이면 밴드 전체
  const minFrac = 0.2;
  const frac = minFrac + (1 - minFrac) * spread01;
  const allowed = Math.max(1, Math.floor(bandArr.length * frac));
  const pool = bandArr.slice(0, allowed);

  // partial Fisher-Yates using deterministic PRNG
  for (let i = 0; i < Math.min(pickCount, pool.length); i++) {
    const j = i + prng.nextInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, pickCount);
}

function makePickPlan(pickTotal, preset) {
  // preset: "balanced" | "high" | "spread" | "low"
  // return [high, mid, low] that sums to pickTotal
  if (pickTotal <= 0) return [0, 0, 0];
  const base = {
    balanced: [4, 3, 3],
    high: [6, 3, 1],
    spread: [3, 4, 3],
    low: [3, 3, 4],
  }[preset] || [4, 3, 3];

  const sum = base[0] + base[1] + base[2];
  // scale to pickTotal
  let h = Math.round((base[0] / sum) * pickTotal);
  let m = Math.round((base[1] / sum) * pickTotal);
  let l = pickTotal - h - m;
  if (l < 0) { l = 0; if (m > 0) m--; else if (h > 0) h--; }
  while (h + m + l < pickTotal) l++;
  return [h, m, l];
}

function recommendNumberSet({ ranked, pickTotal, preset, spread01, seedStr }) {
  // ranked is array length 70
  const high = ranked.slice(0, 20);
  const mid = ranked.slice(20, 40);
  const low = ranked.slice(40);

  const prng = makeXorShift32(fnv1a32(seedStr));
  const [hCnt, mCnt, lCnt] = makePickPlan(pickTotal, preset);

  const picks = [
    ...pickFromBand(high, hCnt, spread01, prng),
    ...pickFromBand(mid, mCnt, spread01, prng),
    ...pickFromBand(low, lCnt, spread01, prng),
  ];

  // uniq + sort
  const uniq = Array.from(new Set(picks)).slice(0, pickTotal);
  uniq.sort((a, b) => a - b);

  // if 부족하면(극히 드묾) 밴드 전체에서 채우기
  if (uniq.length < pickTotal) {
    const pr2 = makeXorShift32(fnv1a32(seedStr + "|fill"));
    const allPool = ranked.slice(0);
    for (let i = 0; i < allPool.length && uniq.length < pickTotal; i++) {
      const j = i + pr2.nextInt(allPool.length - i);
      [allPool[i], allPool[j]] = [allPool[j], allPool[i]];
      if (!uniq.includes(allPool[i])) uniq.push(allPool[i]);
    }
    uniq.sort((a, b) => a - b);
  }

  return { numbers: uniq, band: { high: hCnt, mid: mCnt, low: lCnt } };
}

function recommendSumGame({ sumBinFreqAll, sumBinFreqRecent, w01, seedStr }) {
  // bins: b1..b6
  const bins = ["b1", "b2", "b3", "b4", "b5", "b6"];

  const allTotal = bins.reduce((a, k) => a + (sumBinFreqAll[k] || 0), 0);
  const rTotal = bins.reduce((a, k) => a + (sumBinFreqRecent[k] || 0), 0);

  const score = {};
  for (const b of bins) {
    const a = allTotal ? (sumBinFreqAll[b] || 0) / allTotal : 0;
    const r = rTotal ? (sumBinFreqRecent[b] || 0) / rTotal : 0;
    score[b] = (1 - w01) * a + w01 * r;
  }

  bins.sort((x, y) => {
    if (score[y] !== score[x]) return score[y] - score[x];
    return x.localeCompare(y);
  });

  const prng = makeXorShift32(fnv1a32(seedStr + "|sum"));
  // 상/중/하 느낌으로 top2/mid2/low2에서 하나씩 섞되, seed로 결정
  const top = bins.slice(0, 2);
  const mid = bins.slice(2, 4);
  const low = bins.slice(4);

  const pickGroup = prng.nextInt(3); // 0,1,2
  let chosen;
  if (pickGroup === 0) chosen = top[prng.nextInt(top.length)];
  else if (pickGroup === 1) chosen = mid[prng.nextInt(mid.length)];
  else chosen = low[prng.nextInt(low.length)];

  return { bin: chosen, label: binLabel(chosen), rank: bins };
}

// -------------------- recommend from repo data (for Issue) --------------------
function parseRecommendCommand(body) {
  // Examples:
  // /speedkeno
  // /speedkeno 10 seed=TEAM-A cycle=123 recent=30 w=60 spread=80 pick=10 preset=balanced
  const defaults = {
    sets: 5,
    seed: "TEAM",
    cycle: 1,
    recent: 30,
    w: 60,
    spread: 70,
    pick: 10,
    preset: "balanced",
  };

  const line = (body || "").split("\n").find((l) => l.includes("/speedkeno")) || "";
  const tokens = line.trim().split(/\s+/);

  // tokens[0] = /speedkeno
  if (tokens.length >= 2) {
    const n = Number(tokens[1]);
    if (Number.isFinite(n) && n > 0) defaults.sets = Math.min(20, Math.max(1, n));
  }

  for (const t of tokens.slice(2)) {
    const [k, ...rest] = t.split("=");
    const v = rest.join("=");
    if (!v) continue;
    if (k === "seed") defaults.seed = v;
    if (k === "cycle") {
      const n = Number(v); if (Number.isFinite(n)) defaults.cycle = Math.max(0, Math.floor(n));
    }
    if (k === "recent") {
      const n = Number(v); if ([10, 20, 30].includes(n)) defaults.recent = n;
    }
    if (k === "w") {
      const n = Number(v); if (Number.isFinite(n)) defaults.w = Math.min(100, Math.max(0, n));
    }
    if (k === "spread") {
      const n = Number(v); if (Number.isFinite(n)) defaults.spread = Math.min(100, Math.max(0, n));
    }
    if (k === "pick") {
      const n = Number(v); if (Number.isFinite(n)) defaults.pick = Math.min(10, Math.max(2, Math.floor(n)));
    }
    if (k === "preset") {
      if (["balanced", "high", "spread", "low"].includes(v)) defaults.preset = v;
    }
  }

  return defaults;
}

function mdNumberLine(nums) {
  return nums.map((n) => String(n).padStart(2, "0")).join(" ");
}

// -------------------- main modes --------------------
async function runRecommendMode(commandText) {
  const cfg = parseRecommendCommand(commandText);
  const draws = await readJsonSafe(DRAWS_PATH, []);
  if (!Array.isArray(draws) || draws.length === 0) {
    return [
      "⚠️ 아직 데이터가 없습니다.",
      "",
      "- Actions에서 `update-speedkeno.yml` 워크플로우를 한 번 실행해 `data/speedkeno_draws.json`이 채워진 뒤 다시 `/speedkeno`를 호출하세요.",
    ].join("\n");
  }

  // freq from draws
  const freqAll = computeFreq(draws);
  const recentObj = freqAll.recent[String(cfg.recent)] || computeFreqShallow(draws.slice(-cfg.recent));
  const w01 = cfg.w / 100;
  const spread01 = cfg.spread / 100;

  // blended score for number picks
  const scoreNum = blendScore(freqAll.numberFreq, recentObj.numberFreq, w01);
  const ranked = rankByScore(scoreNum);

  // sum bins
  const allSumBin = computeFreqShallow(draws).sumBin;
  const recentSumBin = recentObj.sumBin || computeFreqShallow(draws.slice(-cfg.recent)).sumBin;

  const deviceSeed = "github-actions";
  const baseSeed = `${deviceSeed}|${cfg.seed}|recent=${cfg.recent}|w=${cfg.w}|spread=${cfg.spread}|pick=${cfg.pick}|preset=${cfg.preset}`;

  const out = [];
  out.push(`🎯 **스피드키노 추천 (${cfg.sets}세트)**`);
  out.push(`- seed: \`${cfg.seed}\` / cycle: \`${cfg.cycle}\` / recent: \`${cfg.recent}\` / w: \`${cfg.w}\` / spread: \`${cfg.spread}\` / pick: \`${cfg.pick}\` / preset: \`${cfg.preset}\``);
  out.push("");

  // generate sets
  const seen = new Set();
  for (let i = 0; i < cfg.sets; i++) {
    let view = 0;
    let best = null;

    while (view < 200) {
      const seedStr = `${baseSeed}|cycle=${cfg.cycle + i}|view=${view}`;
      const s = recommendNumberSet({ ranked, pickTotal: cfg.pick, preset: cfg.preset, spread01, seedStr });
      const key = s.numbers.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        best = { ...s, seedStr };
        break;
      }
      view++;
    }

    if (!best) continue;

    const sumRec = recommendSumGame({
      sumBinFreqAll: allSumBin,
      sumBinFreqRecent: recentSumBin,
      w01,
      seedStr: best.seedStr,
    });

    out.push(`**#${String(i + 1).padStart(2, "0")}**  [밴드: 상${best.band.high}/중${best.band.mid}/하${best.band.low}]`);
    out.push(`- 넘버스(추천번호): ${mdNumberLine(best.numbers)}`);
    out.push(`- 숫자합(추천구간): **${sumRec.label}**  (bin=${sumRec.bin})`);
    out.push("");
  }

  out.push("> 참고: 과거 빈도 기반 추천은 ‘당첨 보장’이 아닙니다. (결정론 추천 + 순환 다양화 목적)");
  return out.join("\n");
}

async function runUpdateMode() {
  await ensureDir(DATA_DIR);

  const existing = await readJsonSafe(DRAWS_PATH, []);
  const map = new Map();
  if (Array.isArray(existing)) {
    for (const d of existing) {
      if (d && d.key) map.set(d.key, d);
    }
  }

  // source A
  let apiArr = [];
  try {
    apiArr = await fetchJson(SRC_API, { tries: 2, timeoutMs: 15000 });
    if (!Array.isArray(apiArr)) apiArr = [];
  } catch (e) {
    console.error(`[FAIL] SRC_API: ${e.message}`);
  }

  // source B
  let intervalMap = new Map();
  try {
    const html = await fetchText(SRC_INTERVAL, { tries: 2, timeoutMs: 15000 });
    intervalMap = parseIntervalHtml(html);
  } catch (e) {
    console.error(`[FAIL] SRC_INTERVAL: ${e.message}`);
  }

  // normalize & cross-check
  let added = 0, checked = 0, matched = 0, mismatched = 0;

  for (const it of apiArr) {
    const date = String(it?.Date || "");
    const round = Number(it?.Round);
    const numbersStr = it?.SpeedKeno?.Number || "";
    const lucky = Number(it?.SpeedKeno?.Lucky);
    const sum = Number(it?.SpeedKeno?.Sum);

    if (!/^\d{8}$/.test(date)) continue;
    if (!Number.isFinite(round)) continue;

    const nums = String(numbersStr)
      .split(",")
      .map((x) => Number.parseInt(x, 10))
      .filter((v) => Number.isFinite(v));

    if (nums.length !== 22) continue;

    const key = normalizeKey(date, round);

    // cross-check if possible
    if (intervalMap.size > 0 && intervalMap.has(key)) {
      checked++;
      const b = intervalMap.get(key);
      const sameNums = b.numbers.join(",") === nums.join(",");
      const sameLucky = Number(b.lucky) === lucky;
      const sameSum = Number(b.sum) === sum;
      if (sameNums && sameLucky && sameSum) matched++;
      else {
        mismatched++;
        // mismatch → 안전하게 스킵(데이터 꼬임 방지)
        continue;
      }
    }

    if (!map.has(key)) {
      map.set(key, {
        key,
        id: Number(it?.ID) || null,
        date,
        round,
        gameType: it?.gameType || null,
        dhRound: it?.dhRound ?? null,
        resultImage: it?.ResultImage ?? null,
        numbers: nums,
        lucky,
        sum,
        meta: {
          luckyOddEven: it?.SpeedKeno?.luckyOddEven ?? null,
          luckyUnderOver: it?.SpeedKeno?.luckyUnderOver ?? null,
          sumOddEven: it?.SpeedKeno?.sumOddEven ?? null,
          sumUnderOver: it?.SpeedKeno?.sumUnderOver ?? null,
        },
      });
      added++;
    }
  }

  // sort
  const merged = Array.from(map.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return Number(a.round) - Number(b.round);
  });

  await writeJsonPretty(DRAWS_PATH, merged);

  const freq = computeFreq(merged);
  freq.health = {
    sourceA: SRC_API,
    sourceB: SRC_INTERVAL,
    crosscheck: { checked, matched, mismatched },
    note: "sourceB(HTML) is used for consistency check when available.",
  };
  await writeJsonPretty(FREQ_PATH, freq);

  console.log(`[OK] draws=${merged.length} (+${added}) crosscheck checked=${checked} matched=${matched} mismatched=${mismatched}`);
}

async function main() {
  const args = process.argv.slice(2);
  const recommend = args.includes("--recommend");
  if (recommend) {
    const idx = args.indexOf("--command");
    const cmd = idx >= 0 ? (args[idx + 1] || "") : "";
    const md = await runRecommendMode(cmd);
    process.stdout.write(md + "\n");
    return;
  }
  await runUpdateMode();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
