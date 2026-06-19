const fs = require("fs");
const XLSX = require("xlsx");

const file = process.argv[2] || "C:/Users/shirl/Downloads/Right Impact Partners Plan Credits Allocation - Updated 28 Feb 2026.xlsx";
const projectId = Number(process.argv[3] || 22232);

if (!fs.existsSync(file)) {
  console.error("File not found:", file);
  process.exit(1);
}

const wb = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
const monthlySheets = wb.SheetNames.filter((name) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i.test(name));

console.log("Project ID:", projectId);
console.log("Monthly sheets with project:");
monthlySheets.forEach((name) => {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
  const hit = rows.find((row) => row["Project ID"] === projectId);
  if (hit) {
    console.log(`- ${name}:`, {
      title: hit.Title,
      first: hit["First Completion"],
      last: hit["Last Completion"],
      month: hit.Month,
      debited: hit["Debited (USD)"] || hit["To Debit"]
    });
  }
});

const ps = XLSX.utils.sheet_to_json(wb.Sheets["Project Statistics"] || {}, { defval: "" });
const stat = ps.find((row) => row["Project ID"] === projectId);
console.log("\nProject Statistics row:", stat || "NOT FOUND");
