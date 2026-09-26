import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const spamByUser = new Map();

export const containsBadLanguage = (text) => matcher.hasMatch(String(text || ""));

const SHORT_SLANG = ["wtf", "stfu", "gtfo", "omfg", "bsdk", "mkc", "bkl", "mc", "bc", "tf"];

const PHRASE_SLANG = [
  "chutiya",
  "chutiye",
  "madarchod",
  "madharchod",
  "behenchod",
  "bhenchod",
  "bhosdike",
  "bhosdi",
  "gandu",
  "harami",
  "lauda",
  "lawda",
  "jhatu",
  "motherfucker",
  "bullshit",
  "asshole",
  "dickhead",
  "bastard",
];

const ALLOWED_CHAT = new Set([
  "gg",
  "gl",
  "hf",
  "glhf",
  "ggwp",
  "wp",
  "ty",
  "thx",
  "thanks",
  "thank you",
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "yes",
  "no",
  "yo",
  "lol",
  "mate",
  "check",
  "draw",
  "resign",
  "good",
  "nice",
  "wow",
  "good game",
  "well played",
  "good luck",
  "have fun",
  "congrats",
  "congratulations",
  "blunder",
  "brilliant",
  "puzzle",
  "move",
  "time",
  "clock",
]);

const foldForSlang = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t");

export const containsSlang = (text) => {
  const folded = foldForSlang(text);
  const tokens = folded.split(/[^a-z]+/).filter(Boolean);
  if (tokens.some((token) => SHORT_SLANG.includes(token))) return true;
  const compact = tokens.join("");
  return PHRASE_SLANG.some((term) => compact.includes(term));
};

export const normalizeChatText = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isChessMove = (text) => {
  const cleaned = String(text || "")
    .trim()
    .replace(/[!?+#]+$/g, "")
    .replace(/\s+/g, "");
  if (!cleaned || cleaned.length > 10) return false;
  return /^(?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?)$/i.test(
    cleaned,
  );
};

const isAllowedChatText = (text) => {
  if (isChessMove(text)) return true;
  return ALLOWED_CHAT.has(normalizeChatText(text));
};

const hasKeyboardWalk = (letters) => {
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  for (let index = 0; index <= letters.length - 5; index += 1) {
    const slice = letters.slice(index, index + 5);
    if (rows.some((row) => row.includes(slice))) return true;
  }
  return false;
};

const isKeyboardMash = (text) => {
  if (isAllowedChatText(text)) return false;
  const letters = String(text || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (letters.length < 6) return false;
  if (/(.)\1{4,}/.test(letters)) return true;
  if (hasKeyboardWalk(letters)) return true;
  const vowels = (letters.match(/[aeiou]/g) || []).length;
  const unique = new Set(letters).size;
  if (vowels === 0) return true;
  if (letters.length >= 8 && unique <= 2) return true;
  if (letters.length >= 7 && unique <= 5 && vowels / letters.length < 0.34) return true;
  return false;
};

const isMostlySymbols = (text) => {
  const trimmed = String(text || "").trim();
  if (trimmed.length < 6 || isAllowedChatText(trimmed)) return false;
  if (/^[\p{Extended_Pictographic}\uFE0F\s]+$/u.test(trimmed)) return false;
  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  return letters / trimmed.length < 0.4;
};

const isShouting = (text) => {
  if (isAllowedChatText(text)) return false;
  const letters = String(text || "").match(/[A-Za-z]/g) || [];
  if (letters.length < 12) return false;
  const caps = letters.filter((letter) => letter >= "A" && letter <= "Z").length;
  return caps / letters.length > 0.85;
};

const editDistance = (left, right) => {
  const a = left.slice(0, 40);
  const b = right.slice(0, 40);
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
};

const isRepeatedSpam = (text, recentTexts) => {
  const norm = normalizeChatText(text);
  if (norm.length < 6 || isAllowedChatText(text)) return false;
  return (recentTexts || []).some((prev) => {
    if (!prev || Math.abs(prev.length - norm.length) > 4) return false;
    if (prev === norm) return true;
    return editDistance(prev, norm) <= 3;
  });
};

export const isContentSpam = (text, recentTexts = []) =>
  isKeyboardMash(text) || isMostlySymbols(text) || isShouting(text) || isRepeatedSpam(text, recentTexts);

const lockSecondsFor = (offenseCount) => {
  if (offenseCount <= 1) return 20;
  if (offenseCount === 2) return 60;
  return 180;
};

const lockLabelFor = (seconds) => {
  if (seconds >= 180) return "3 minutes";
  if (seconds >= 60) return "1 minute";
  return "20 seconds";
};

const beginSpamLock = (state, now) => {
  state.offenses += 1;
  const seconds = lockSecondsFor(state.offenses);
  state.lockedUntil = now + seconds * 1000;
  state.times.push(now);
  return {
    blocked: true,
    seconds,
    message: `Please do not spam! Chat disabled for ${lockLabelFor(seconds)}.`,
  };
};

export const checkChatSpam = (userId, text = "") => {
  const now = Date.now();
  const state = spamByUser.get(userId) || { times: [], offenses: 0, lockedUntil: 0, texts: [] };
  state.texts = Array.isArray(state.texts) ? state.texts : [];

  if (state.lockedUntil > now) {
    const seconds = Math.ceil((state.lockedUntil - now) / 1000);
    spamByUser.set(userId, state);
    return {
      blocked: true,
      seconds,
      message: `Please do not spam! Chat disabled for ${lockLabelFor(lockSecondsFor(state.offenses))}.`,
    };
  }

  state.texts = state.texts.filter((item) => now - item.at < 120000);
  const recentTexts = state.texts.map((item) => item.text);
  state.times = state.times.filter((sentAt) => now - sentAt < 20000);

  if (isContentSpam(text, recentTexts) || state.times.length >= 3) {
    const result = beginSpamLock(state, now);
    spamByUser.set(userId, state);
    return result;
  }

  state.times.push(now);
  const normalized = normalizeChatText(text);
  if (normalized) {
    state.texts = [...state.texts, { text: normalized, at: now }].slice(-8);
  }
  spamByUser.set(userId, state);
  return { blocked: false };
};
