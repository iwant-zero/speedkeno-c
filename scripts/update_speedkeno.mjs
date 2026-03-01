// scripts/update_speedkeno.mjs
// ✅ Update: data/speedkeno_draws.json + data/speedkeno_freq.json 갱신
// ✅ Recommend: GitHub Issue 댓글(/speedkeno ...)로 추천 마크다운 생성
//
// 주의:
// - 무작위(Math.random/crypto) 사용 0%
// - 데이터 소스: BEPICK API(최근 30회차) + BEPICK interval HTML(교차검증)
// - "역대"는 저장된 data 누적 기준(처음엔 최근 30부터 쌓이고, 이후 Actions로 계속 누적)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DRAWS_PATH = path.join(DATA_DIR, "speedkeno_draws.json");
const FREQ_PATH = path.join(DATA_DIR, "speedkeno_freq.json");

// ✅ Sources
const API_CANDIDATES = [
  "https://api.bepick.io/keno/get/",
  "https://api.bepick.net/keno/get/"
];
// interval page = 최근 N게임 테이블(HTML) → API 교차검증용
const SRC_INTERVAL = "https://bepick.net/game/interval/speedkeno";

// ✅ 숫자합 게임 구간(9개) — 사용자 제공 룰 그대로
const SUM_BINS = [
  { key: "b1", min: 253, max: 486, label: "253-486", limited1PerDraw: true },  // 1등 구간(1회 1매)
  { key: "b2", min: 487, max: 512, label: "487-512", limited1PerDraw: true },  // 2등 구간(1회 1매)
  { key: "b3", min: 513, max: 568, label: "513-568" },
  { key: "b4", min: 569, max: 594, label: "569-594" },
  { key: "b5", min: 595, max: 663, label: "595-663" },
  { key: "b6", min: 664, max: 700, label: "664-700" },
  { key: "b7", min: 701, max: 740, label: "701-740" },
  { key: "b8", min: 741, max: 803, label: "741-803" },
  { key: "b9", min: 804, max: 1309, label: "804-1309" }
];

function sumToBin(sum) {
  for (const b of SUM_BINS) {
    if (sum >= b.min && sum <= b.max) return b.key;
  }
  // 범위 밖 보호
  if (sum < SUM_BINS[0].min) return SUM_BINS[0].key;
  return SUM_BINS[SUM_BINS.length - 1].key;
}
function binLabel(bin) {
  return SUM_BINS.find(x => x.key === bin)?.label || bin;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function nowISO() { return new Date().toISOString(); }

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
async function readJsonSafe(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); }
  catch { return fallback; }
}
async function writeJsonPretty(p, obj) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function fetchText(url, { timeoutMs = 15000, tries = 2 } = {}) {
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

async function fetchJson(url, opt = {}) {
  const txt = await fetchText(url, opt);
  const trimmed = txt.trim();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    throw new Error(`Non-JSON response (blocked?) from ${url}`);
  }
  return JSON.parse(trimmed);
}

function normalizeKey(dateYYYYMMDD, round) {
  return `${dateYYYYMMDD}-${Number(round)}`;
}

// -------------------- interval HTML parse (교차검증) --------------------
// table row example (bepick interval):
// 2026-03-01-264
// 21:59:11
// 47,43,03,...,24 24 C 890 A
function parseIntervalHtml(html) {
  const lines = html.split("\n");
  const out = new Map();

  let curKey = null;
  let curTime = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // key like 2026-03-01-264
    const k = line.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{1,4})$/);
    if (k) {
      const date = `${k[1]}${k[2]}${k[3]}`;
      const round = Number(k[4]);
      curKey = normalizeKey(date, round);
      curTime = null;
      continue;
    }

    // time like 21:59:11
    const tm = line.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (curKey && tm) {
      curTime = line;
      continue;
    }

    // numbers + lucky + sum in one line
    if (curKey) {
      const m = line.match(/((?:\d{1,2},){21}\d{1,2})\s+(\d{1,2})\s+[A-Z]\s+(\d{1,4})/);
      if (m) {
        const nums = m[1].split(",").map(v => parseInt(v, 10)).filter(Number.isFinite);
        const lucky = Number(m[2]);
        const sum = Number(m[3]);
        if (nums.length === 22 && lucky >= 1 && lucky <= 70 && Number.isFinite(sum)) {
          out.set(curKey, { time: curTime || null, numbers: nums, lucky, sum });
        }
        curKey = null;
        curTime = null;
      }
    }
  }

  return out;
}

// -------------------- freq 계산 --------------------
function makeEmptyFreq() {
  const n = {}, l = {};
  for (let i = 1; i <= 70; i++) { n[i] = 0; l[i] = 0; }
  const sumBins = {};
  for (const b of SUM_BINS) sumBins[b.key] = 0;
  return { numberFreq: n, luckyFreq: l, sumBinFreq: sumBins };
}

function computeFreqShallow(draws) {
  const base = makeEmptyFreq();
  for (const d of draws) {
    for (const x of d.numbers || []) if (x >= 1 && x <= 70) base.numberFreq[x] += 1;
    if ((d.lucky || 0) >= 1 && d.lucky <= 70) base.luckyFreq[d.lucky] += 1;

    const s = Number(d.sum);
    if (Number.isFinite(s)) {
      const bin = sumToBin(s);
      base.sumBinFreq[bin] += 1;
    }
  }
  return base;
}

function computeFreq(draws) {
  const totalDraws = draws.length;
  const base = computeFreqShallow(draws);

  const recentWindows = [10, 20, 30];
  const recent = {};
  for (const w of recentWindows) {
    const sub = draws.slice(Math.max(0, draws.length - w));
    recent[w] = computeFreqShallow(sub);
  }

  return {
    updatedAt: nowISO(),
    totalDraws,
    numberFreq: base.numberFreq,
    luckyFreq: base.luckyFreq,
    sumBinFreq: base.sumBinFreq,
    recent,
    sumBins: SUM_BINS.map(b => ({ key: b.key, label: b.label, min: b.min, max: b.max, limited1PerDraw: !!b.limited1PerDraw })),
  };
}

// -------------------- 결정론 PRNG (no Math.random) --------------------
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
  let aT = 0, rT = 0;
  for (const k of Object.keys(allFreq)) aT += (allFreq[k] || 0);
  for (const k of Object.keys(recentFreq)) rT += (recentFreq[k] || 0);

  const out = {};
  for (const k of Object.keys(allFreq)) {
    const a = aT ? (allFreq[k] || 0) / aT : 0;
    const r = rT ? (recentFreq[k] || 0) / rT : 0;
    out[k] = (1 - w01) * a + w01 * r;
  }
  return out;
}

function rankKeysByScore(scoreObj) {
  const keys = Object.keys(scoreObj);
  keys.sort((a, b) => {
    const da = scoreObj[a] ?? 0;
    const db = scoreObj[b] ?? 0;
    if (db !== da) return db - da;
    return String(a).localeCompare(String(b));
  });
  return keys;
}

function rankNumbersByScore(scoreObj) {
  const arr = Array.from({ length: 70 }, (_, i) => i + 1);
  arr.sort((a, b) => {
    const da = scoreObj[a] ?? 0;
    const db = scoreObj[b] ?? 0;
    if (db !== da) return db - da;
    return a - b;
  });
  return arr;
}

function pickFromBand(bandArr, pickCount, spread01, prng) {
  // spread01=0이면 상단20%만, 1이면 전체
  const minFrac = 0.2;
  const frac = minFrac + (1 - minFrac) * spread01;
  const allowed = Math.max(1, Math.floor(bandArr.length * frac));
  const pool = bandArr.slice(0, allowed);

  for (let i = 0; i < Math.min(pickCount, pool.length); i++) {
    const j = i + prng.nextInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, pickCount);
}

function makePickPlan(pickTotal, preset) {
  // pick2~pick10 지원
  const base = {
    balanced: [4, 3, 3],
    high: [6, 3, 1],
    spread: [3, 4, 3],
    low: [3, 3, 4],
  }[preset] || [4, 3, 3];

  const sum = base[0] + base[1] + base[2];
  let h = Math.round((base[0] / sum) * pickTotal);
  let m = Math.round((base[1] / sum) * pickTotal);
  let l = pickTotal - h - m;
  if (l < 0) { l = 0; if (m > 0) m--; else if (h > 0) h--; }
  while (h + m + l < pickTotal) l++;
  return [h, m, l];
}

function recommendNumberSet({ rankedNums, pickTotal, preset, spread01, seedStr }) {
  const high = rankedNums.slice(0, 20);
  const mid = rankedNums.slice(20, 40);
  const low = rankedNums.slice(40);

  const prng = makeXorShift32(fnv1a32(seedStr));
  const [hCnt, mCnt, lCnt] = makePickPlan(pickTotal, preset);

  const picks = [
    ...pickFromBand(high, hCnt, spread01, prng),
    ...pickFromBand(mid, mCnt, spread01, prng),
    ...pickFromBand(low, lCnt, spread01, prng),
  ];

  const uniq = Array.from(new Set(picks)).slice(0, pickTotal).sort((a, b) => a - b);

  // 부족분 채우기
  if (uniq.length < pickTotal) {
    const pr2 = makeXorShift32(fnv1a32(seedStr + "|fill"));
    const pool = rankedNums.slice();
    for (let i = 0; i < pool.length && uniq.length < pickTotal; i++) {
      const j = i + pr2.nextInt(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
      if (!uniq.includes(pool[i])) uniq.push(pool[i]);
    }
    uniq.sort((a, b) => a - b);
  }

  return { numbers: uniq, band: { high: hCnt, mid: mCnt, low: lCnt } };
}

function recommendSumTicket({ rankedBins, spread01, seedStr, usedLimited }) {
  // 9개를 3/3/3 상중하로 나눔
  const top = rankedBins.slice(0, 3);
  const mid = rankedBins.slice(3, 6);
  const low = rankedBins.slice(6, 9);

  const prng = makeXorShift32(fnv1a32(seedStr + "|sum"));
  const group = prng.nextInt(3); // 0/1/2
  const band = group === 0 ? top : (group === 1 ? mid : low);

  // spread01로 top 제한 완화
  const pickOne = (arr) => {
    const minFrac = 0.35;
    const frac = minFrac + (1 - minFrac) * spread01;
    const allowed = Math.max(1, Math.floor(arr.length * frac));
    return arr[prng.nextInt(allowed)];
  };

  let chosen = pickOne(band);

  // 1회 1매 제한(b1,b2) 처리: 이미 사용했으면 다음 후보로 이동
  const isLimited = (k) => SUM_BINS.find(b => b.key === k)?.limited1PerDraw;
  if (isLimited(chosen) && usedLimited.has(chosen)) {
    // fallback: 전체 rankedBins에서 제한 아닌 걸로 재탐색
    for (const k of rankedBins) {
      if (!isLimited(k) || !usedLimited.has(k)) { chosen = k; break; }
    }
  }
  if (isLimited(chosen)) usedLimited.add(chosen);

  return { bin: chosen, label: binLabel(chosen) };
}

// -------------------- Recommend mode (Issue) --------------------
function parseRecommendCommand(body) {
  // Examples:
  // /speedkeno
  // /speedkeno 10 seed=TEAM-A cycle=123 recent=30 w=60 spread=70 pick=10 preset=balanced mode=both
  // /speedkeno 5 mode=sum seed=AAA
  const cfg = {
    sets: 5,
    mode: "both", // numbers | sum | both
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

  if (!tokens[0].includes("/speedkeno")) return cfg;

  // token[1] could be a number (sets)
  if (tokens.length >= 2) {
    const n = Number(tokens[1]);
    if (Number.isFinite(n) && n > 0) cfg.sets = Math.min(20, Math.max(1, Math.floor(n)));
  }

  for (const t of tokens.slice(2)) {
    const [k, ...rest] = t.split("=");
    const v = rest.join("=");
    if (!v) continue;
    if (k === "seed") cfg.seed = v;
    if (k === "cycle") { const n = Number(v); if (Number.isFinite(n)) cfg.cycle = Math.max(0, Math.floor(n)); }
    if (k === "recent") { const n = Number(v); if ([10, 20, 30].includes(n)) cfg.recent = n; }
    if (k === "w") { const n = Number(v); if (Number.isFinite(n)) cfg.w = Math.min(100, Math.max(0, n)); }
    if (k === "spread") { const n = Number(v); if (Number.isFinite(n)) cfg.spread = Math.min(100, Math.max(0, n)); }
    if (k === "pick") { const n = Number(v); if (Number.isFinite(n)) cfg.pick = Math.min(10, Math.max(2, Math.floor(n))); }
    if (k === "preset") { if (["balanced", "high", "spread", "low"].includes(v)) cfg.preset = v; }
    if (k === "mode") { if (["numbers", "sum", "both"].includes(v)) cfg.mode = v; }
  }

  return cfg;
}

function mdNums(nums) {
  return nums.map(n => String(n).padStart(2, "0")).join(" ");
}

async function runRecommendMode(commandText) {
  const cfg = parseRecommendCommand(commandText || "");
  const draws = await readJsonSafe(DRAWS_PATH, []);
  if (!Array.isArray(draws) || draws.length === 0) {
    return [
      "⚠️ 아직 데이터가 없습니다.",
      "",
      "- Actions에서 `update-speedkeno.yml` 워크플로우를 한 번 실행해 `data/speedkeno_draws.json`이 채워진 뒤 다시 `/speedkeno`를 호출하세요.",
    ].join("\n");
  }

  const freqAll = computeFreq(draws);
  const recentObj = freqAll.recent[String(cfg.recent)] || computeFreqShallow(draws.slice(-cfg.recent));
  const w01 = cfg.w / 100;
  const spread01 = cfg.spread / 100;

  // numbers ranking
  const scoreNum = blendScore(freqAll.numberFreq, recentObj.numberFreq, w01);
  const rankedNums = rankNumbersByScore(scoreNum);

  // sum bin ranking
  const scoreBin = blendScore(freqAll.sumBinFreq, recentObj.sumBinFreq, w01);
  const rankedBins = rankKeysByScore(scoreBin);

  const deviceSeed = "github-actions";
  const baseSeed = `${deviceSeed}|${cfg.seed}|recent=${cfg.recent}|w=${cfg.w}|spread=${cfg.spread}|pick=${cfg.pick}|preset=${cfg.preset}|mode=${cfg.mode}`;

  const out = [];
  out.push(`🎯 **스피드키노 추천 (${cfg.sets}세트)**`);
  out.push(`- mode=\`${cfg.mode}\` / seed=\`${cfg.seed}\` / cycle=\`${cfg.cycle}\` / recent=\`${cfg.recent}\` / w=\`${cfg.w}\` / spread=\`${cfg.spread}\``);
  out.push(`- numbers pick=\`${cfg.pick}\` (2~10) / preset=\`${cfg.preset}\``);
  out.push("");

  const usedLimited = new Set(); // b1/b2 제한용

  for (let i = 0; i < cfg.sets; i++) {
    const seedStr = `${baseSeed}|cycle=${cfg.cycle + i}|view=0`;

    if (cfg.mode === "numbers" || cfg.mode === "both") {
      const s = recommendNumberSet({
        rankedNums,
        pickTotal: cfg.pick,
        preset: cfg.preset,
        spread01,
        seedStr: seedStr + "|numbers",
      });
      out.push(`**#${String(i + 1).padStart(2, "0")} (넘버스게임)**  [밴드: 상${s.band.high}/중${s.band.mid}/하${s.band.low}]`);
      out.push(`- 선택번호(${cfg.pick}개): ${mdNums(s.numbers)}`);
    }

    if (cfg.mode === "sum" || cfg.mode === "both") {
      const t = recommendSumTicket({
        rankedBins,
        spread01,
        seedStr: seedStr + "|sum",
        usedLimited,
      });
      out.push(`- 숫자합게임(구간): **${t.label}** (bin=${t.bin})`);
      if (t.bin === "b1" || t.bin === "b2") {
        out.push(`  - ⚠️ 참고: 1등/2등 구간은 **1회 1매 제한**`);
      }
    }

    out.push("");
  }

  out.push("> 참고: 과거 빈도 기반 추천은 ‘당첨 보장’이 아닙니다. (결정론 추천 + 순환 다양화 목적)");
  out.push("");
  out.push("**명령 예시**");
  out.push("- `/speedkeno`");
  out.push("- `/speedkeno 10 seed=TEAM-A cycle=123 recent=30 w=60 spread=80 pick=10 preset=balanced mode=both`");
  out.push("- `/speedkeno 10 seed=TEAM-A mode=sum`");
  out.push("- `/speedkeno 10 seed=TEAM-A mode=numbers pick=8`");

  return out.join("\n");
}

// -------------------- Update mode --------------------
function normalizeApiItem(it) {
  const date = String(it?.Date || "");
  const round = Number(it?.Round);
  const numbersStr = it?.SpeedKeno?.Number || "";
  const lucky = Number(it?.SpeedKeno?.Lucky);
  const sum = Number(it?.SpeedKeno?.Sum);

  if (!/^\d{8}$/.test(date)) return null;
  if (!Number.isFinite(round)) return null;

  const nums = String(numbersStr)
    .split(",")
    .map((x) => Number.parseInt(x, 10))
    .filter((v) => Number.isFinite(v));

  if (nums.length !== 22) return null;
  if (!(lucky >= 1 && lucky <= 70)) return null;
  if (!Number.isFinite(sum)) return null;

  const key = normalizeKey(date, round);

  return {
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
    sumBin: sumToBin(sum),
    meta: {
      luckyOddEven: it?.SpeedKeno?.luckyOddEven ?? null,
      luckyUnderOver: it?.SpeedKeno?.luckyUnderOver ?? null,
      sumOddEven: it?.SpeedKeno?.sumOddEven ?? null,
      sumUnderOver: it?.SpeedKeno?.sumUnderOver ?? null,
    },
  };
}

function isSameDraw(a, b) {
  if (!a || !b) return false;
  if (a.lucky !== b.lucky) return false;
  if (a.sum !== b.sum) return false;
  return (a.numbers || []).join(",") === (b.numbers || []).join(",");
}

async function runUpdateMode() {
  await ensureDir(DATA_DIR);

  const existing = await readJsonSafe(DRAWS_PATH, []);
  const map = new Map();
  if (Array.isArray(existing)) {
    for (const d of existing) if (d?.key) map.set(d.key, d);
  }

  // interval (교차검증용)
  let intervalMap = new Map();
  try {
    const html = await fetchText(SRC_INTERVAL, { tries: 2, timeoutMs: 15000 });
    intervalMap = parseIntervalHtml(html);
  } catch (e) {
    console.error(`[WARN] interval parse failed: ${e.message}`);
  }

  // API candidates
  const apiMaps = [];
  for (const url of API_CANDIDATES) {
    try {
      const arr = await fetchJson(url, { tries: 2, timeoutMs: 15000 });
      const m = new Map();
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const norm = normalizeApiItem(it);
          if (norm) m.set(norm.key, norm);
        }
      }
      apiMaps.push({ url, map: m });
    } catch (e) {
      console.error(`[WARN] api failed: ${url} :: ${e.message}`);
      apiMaps.push({ url, map: new Map() });
    }
  }

  // 2-of-3 스타일(가능하면): A vs B vs interval 중 2개 이상 일치하면 채택
  let added = 0;
  let checked = 0, matched = 0, mismatched = 0;
  const unionKeys = new Set();
  for (const a of apiMaps) for (const k of a.map.keys()) unionKeys.add(k);

  for (const key of unionKeys) {
    const cands = [];
    for (const a of apiMaps) if (a.map.has(key)) cands.push(a.map.get(key));

    // interval 후보
    const iv = intervalMap.get(key);
    const intervalCandidate = iv ? ({
      key,
      id: null,
      date: key.split("-")[0],
      round: Number(key.split("-")[1]),
      gameType: "interval-html",
      dhRound: null,
      resultImage: null,
      numbers: iv.numbers,
      lucky: iv.lucky,
      sum: iv.sum,
      sumBin: sumToBin(iv.sum),
      meta: {},
    }) : null;

    // 후보들 중 “동일한 값”이 2개 이상인 걸 채택
    const pool = intervalCandidate ? [...cands, intervalCandidate] : [...cands];
    if (pool.length === 0) continue;

    let chosen = null;

    if (pool.length === 1) {
      chosen = pool[0];
    } else {
      // pairwise match count
      outer:
      for (let i = 0; i < pool.length; i++) {
        let agree = 1;
        for (let j = 0; j < pool.length; j++) {
          if (i === j) continue;
          if (isSameDraw(pool[i], pool[j])) agree++;
        }
        if (agree >= 2) { chosen = pool[i]; break outer; }
      }
      // 못 찾으면 첫 API를 쓰되 mismatch로 기록
      if (!chosen) chosen = pool[0];
    }

    // interval과 비교 가능한 경우 기록
    if (intervalCandidate) {
      checked++;
      if (isSameDraw(chosen, intervalCandidate)) matched++;
      else mismatched++;
    }

    if (!map.has(key)) {
      map.set(key, chosen);
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
    apiCandidates: API_CANDIDATES,
    interval: SRC_INTERVAL,
    crosscheck: { checked, matched, mismatched },
    note: "BEPICK API provides latest 30 results. Repo data grows forward as Actions runs.",
  };
  await writeJsonPretty(FREQ_PATH, freq);

  console.log(`[OK] draws=${merged.length} (+${added}) crosscheck checked=${checked} matched=${matched} mismatched=${mismatched}`);
}

async function main() {
  const args = process.argv.slice(2);
  const recommend = args.includes("--recommend");

  if (recommend) {
    const cmd = process.env.SPEEDKENO_COMMAND || "";
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
