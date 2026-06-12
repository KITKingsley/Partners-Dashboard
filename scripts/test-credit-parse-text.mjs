function toNumber(value) {
  let text = String(value ?? "0")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .trim()
    .replace(/\s*(USD|SGD|MYR|RM)\s*$/i, "")
    .trim();
  const signedMoney = text.match(/^(-?)\s*\$\s*([\d,]+(?:\.\d+)?)/);
  if (signedMoney) {
    const number = Number.parseFloat(signedMoney[2].replace(/,/g, ""));
    return signedMoney[1] === "-" ? -Math.abs(number) : number;
  }
  return Number.parseFloat(text.replace(/,/g, "")) || 0;
}

function parseAmountToken(text) {
  const matches = [...String(text || "").matchAll(/-?\$[\d,]+\.\d{2}/g)];
  return matches.length ? matches[matches.length - 1][0] : "";
}

console.log("amount token", parseAmountToken("Plan -$1,300.00"));
console.log("toNumber -1300", toNumber("-$1,300.00"));
console.log("toNumber 5066", toNumber("$5,066.22"));
