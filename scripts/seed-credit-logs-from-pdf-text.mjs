import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const textPath = process.argv[2] || path.join(root, "fixtures", "ninja-hq-credit-log.txt");
const cpPartner = process.argv[3] || "Right Impact";

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
  return CREDIT_LOG_NOISE.some((pattern) => pattern.test(text));
}

function toNumber(value) {
  let text = String(value ?? "0")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .trim()
    .replace(/\s*(USD|SGD|MYR|RM)\s*$/i, "")
    .trim();
  const signedMoney = text.match(/^(-?)\s*\$\s*([\d,]+(?:\.\d+)?)/);
  if (signedMoney) {
    const number = Number.parseFloat(signedMoney[2].replace(/,/g, ""));
    if (!Number.isFinite(number)) return 0;
    return signedMoney[1] === "-" ? -Math.abs(number) : number;
  }
  const plain = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(plain) ? plain : 0;
}

const MONTH_TO_NUMBER = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
};

function parseDate(value) {
  const text = String(value || "").trim();
  const dmyMatch = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmyMatch) {
    const month = MONTH_TO_NUMBER[dmyMatch[2].toLowerCase()];
    if (month) return `${dmyMatch[3]}-${month}-${String(dmyMatch[1]).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseBlock(lines) {
  const full = lines.join(" ").replace(/\s+/g, " ").trim();
  const dateMatch = full.match(CREDIT_LOG_DATE_START);
  if (!dateMatch) return null;

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
  if (!amountToken) return null;
  const description = rest.replace(amountToken, "").replace(/\s+USD\s*$/i, "").trim();
  if (!description) return null;

  return {
    transaction_date: parseDate(dateMatch[1]),
    description,
    amount: toNumber(amountToken),
    actions: actions || null
  };
}

function parsePdfText(text) {
  const normalized = String(text || "").replace(/\r/g, "").replace(/\t/g, " ");
  const splitPattern = new RegExp(
    `(?<![\\d/])(?=\\d{1,2}\\s+(?:${CREDIT_LOG_MONTHS})\\s+\\d{4}\\b)`,
    "gi"
  );

  return normalized
    .split(splitPattern)
    .map((chunk) => chunk.trim())
    .filter((chunk) => CREDIT_LOG_DATE_START.test(chunk) && !/^Customer Name:/i.test(chunk))
    .map((chunk) => {
      const lines = chunk.split(/\n+/).map((line) => line.trim()).filter((line) => line && !isNoise(line));
      return parseBlock(lines);
    })
    .filter(Boolean);
}

function sqlEscape(value) {
  return String(value ?? "").replace(/'/g, "''");
}

const text = fs.readFileSync(textPath, "utf8");
const rows = parsePdfText(text);
console.log(`Parsed ${rows.length} transactions from ${textPath}`);

if (!rows.length) process.exit(1);

const values = rows
  .map((row) => `('${sqlEscape(cpPartner)}', '${row.transaction_date}', '${sqlEscape(row.description)}', ${row.amount}, ${row.actions ? `'${sqlEscape(row.actions)}'` : "null"})`)
  .join(",\n");

const sql = `delete from credit_usage_logs;\ninsert into credit_usage_logs (cp_partner, transaction_date, description, amount, actions) values\n${values};`;
const out = path.join(root, "scripts", "seed-credit-logs.sql");
fs.writeFileSync(out, sql);
console.log(`Wrote ${out}`);
