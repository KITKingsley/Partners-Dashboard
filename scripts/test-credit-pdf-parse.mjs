import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdfPath = process.argv[2] || path.join(process.env.USERPROFILE || "", "Downloads", "Ninja HQ - Account Balance Transaction History.pdf");

GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url
).href;

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
  /^\$[\d,]+\.\d{2}$/
];

function isCreditLogNoiseLine(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  return CREDIT_LOG_NOISE.some((pattern) => pattern.test(text));
}

function toNumber(value) {
  let text = String(value ?? "0")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .trim()
    .replace(/^\s*(USD|SGD|MYR|RM|\$)\s*/i, "")
    .replace(/\s*(USD|SGD|MYR|RM)\s*$/i, "")
    .replace(/,/g, "");
  let negate = false;
  if (/^\(.*\)$/.test(text)) {
    negate = true;
    text = text.slice(1, -1).trim();
  }
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return 0;
  return negate ? -Math.abs(number) : number;
}

function parseCreditLogTransactionBlock(blockLines) {
  const full = blockLines.join(" ").replace(/\s+/g, " ").trim();
  const dateMatch = full.match(CREDIT_LOG_DATE_START);
  if (!dateMatch) return null;

  const date = dateMatch[1];
  let rest = full.slice(dateMatch[0].length).trim();

  let actionLabel = "";
  if (/\bView Related Invoice\.?\s*$/i.test(rest)) {
    actionLabel = "View Related Invoice";
    rest = rest.replace(/\s*View Related Invoice\.?\s*$/i, "").trim();
  } else if (/\bInvoice not available\.?\s*$/i.test(rest)) {
    actionLabel = "Invoice not available";
    rest = rest.replace(/\s*Invoice not available\.?\s*$/i, "").trim();
  }

  rest = rest.replace(/\s+USD\s*$/i, "").trim();

  const amountMatch = rest.match(/(-?\$[\d,]+\.\d{2})\s*$/);
  if (!amountMatch) return { fail: full };

  const amount = toNumber(amountMatch[1]);
  const description = rest.slice(0, amountMatch.index).trim();
  if (!description) return { fail: full };

  return { Date: date, Description: description, Amount: amount, Actions: actionLabel };
}

function parseCreditLogsPdfText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCreditLogNoiseLine(line));

  const blocks = [];
  let currentBlock = [];

  lines.forEach((line) => {
    if (CREDIT_LOG_DATE_START.test(line)) {
      if (currentBlock.length) blocks.push(currentBlock);
      currentBlock = [line];
      return;
    }
    if (currentBlock.length) currentBlock.push(line);
  });
  if (currentBlock.length) blocks.push(currentBlock);

  return blocks.map((block) => parseCreditLogTransactionBlock(block));
}

async function extractPdfText(filePath) {
  const pdf = await getDocument({ data: fs.readFileSync(filePath) }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let lastY = null;
    let pageText = "";

    content.items.forEach((item) => {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pageText += "\n";
      } else if (lastY !== null && pageText && !pageText.endsWith("\n")) {
        pageText += "\t";
      }
      pageText += item.str;
      lastY = y;
    });

    pages.push(pageText);
  }

  return pages.join("\n");
}

const text = await extractPdfText(pdfPath);
const parsed = parseCreditLogsPdfText(text);
const ok = parsed.filter((row) => row && !row.fail);
const fail = parsed.filter((row) => row?.fail);

console.log("PDF:", pdfPath);
console.log("Blocks:", parsed.length, "OK:", ok.length, "FAIL:", fail.length);
console.log("Sample OK:", ok.slice(0, 3));
if (fail.length) console.log("Sample FAIL:", fail.slice(0, 5));
console.log("\n--- extracted text sample ---\n");
console.log(text.slice(0, 1500));
