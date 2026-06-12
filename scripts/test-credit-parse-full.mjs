import fs from "node:fs";

const pdfText = fs.readFileSync(
  "C:/Users/Asus/Downloads/Ninja HQ - Account Balance Transaction History.pdf",
  "utf8"
);

const CREDIT_LOG_MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const CREDIT_LOG_DATE_START = new RegExp(
  `^(\\d{1,2}\\s+(?:${CREDIT_LOG_MONTHS})\\s+\\d{4})\\b`,
  "i"
);
const CREDIT_LOG_NOISE = [
  /^Powered by Gametize/i,
  /^Ninja HQ - Account Balance/i,
  /^https?:\/\//i,
  /^-- \d+ of \d+ --$/,
  /^\d{1,2}\/\d{1,2}\/\d{2},/,
  /^Date\s+Description\s+Amount\s+Actions$/i,
  /^All Account Balance Transactions$/i,
  /^Customer Name:/i,
  /^Customer Email:/i,
  /^Account Balance$/i,
  /^\$[\d,]+\.\d{2}$/,
  /^USD$/i,
  /^👋/
];

function isNoise(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  return CREDIT_LOG_NOISE.some((p) => p.test(text));
}

function toNumber(value) {
  let text = String(value ?? "0").replace(/[\u2212\u2013\u2014]/g, "-").trim().replace(/\s*(USD|SGD|MYR|RM)\s*$/i, "").trim();
  const signedMoney = text.match(/^(-?)\s*\$\s*([\d,]+(?:\.\d+)?)/);
  if (signedMoney) {
    const number = Number.parseFloat(signedMoney[2].replace(/,/g, ""));
    return signedMoney[1] === "-" ? -Math.abs(number) : number;
  }
  return Number.parseFloat(text.replace(/,/g, "")) || 0;
}

function parseBlock(blockLines) {
  const full = blockLines.join(" ").replace(/\s+/g, " ").trim();
  const dateMatch = full.match(CREDIT_LOG_DATE_START);
  if (!dateMatch) return { fail: full.slice(0, 120) };

  let rest = full.slice(dateMatch[0].length).trim();
  let actions = "";
  if (/\bView Related Invoice\.?\s*$/i.test(rest)) {
    actions = "View Related Invoice";
    rest = rest.replace(/\s*View Related Invoice\.?\s*$/i, "").trim();
  } else if (/\bInvoice not available\.?\s*$/i.test(rest)) {
    actions = "Invoice not available";
    rest = rest.replace(/\s*Invoice not available\.?\s*$/i, "").trim();
  }
  rest = rest.replace(/\s+USD\s*$/i, "").trim();
  const amounts = [...rest.matchAll(/-?\$[\d,]+\.\d{2}/g)];
  const amountToken = amounts.length ? amounts[amounts.length - 1][0] : "";
  if (!amountToken) return { fail: full.slice(0, 120) };
  const description = rest.replace(amountToken, "").replace(/\s+USD\s*$/i, "").trim();
  if (!description) return { fail: full.slice(0, 120) };
  return { date: dateMatch[1], description: description.slice(0, 50), amount: toNumber(amountToken), actions };
}

const lines = pdfText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !isNoise(l));
const blocks = [];
let current = [];
for (const line of lines) {
  if (CREDIT_LOG_DATE_START.test(line)) {
    if (current.length) blocks.push(current);
    current = [line];
  } else if (current.length) current.push(line);
}
if (current.length) blocks.push(current);

const parsed = blocks.map(parseBlock);
const ok = parsed.filter((r) => !r.fail);
const fail = parsed.filter((r) => r.fail);
console.log("lines", lines.length, "blocks", blocks.length, "ok", ok.length, "fail", fail.length);
if (fail.length) console.log("fails", fail.slice(0, 5));
