// One-shot: replace hard-coded plan numbers in locale strings with placeholders.
// terms.plansBody -> {starter} {growth} {pro} {freeReplies} {freePosts}
// pricing.count1 -> {replies}; landing.flow.limits.s4d -> {topup}
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "..", "locales");
const BN = "\u09E6\u09E7\u09E8\u09E9\u09EA\u09EB\u09EC\u09ED\u09EE\u09EF"; // Bengali digits 0-9
const toAscii = (s) => s.replace(/[\u09E6-\u09EF]/g, (c) => String(BN.indexOf(c)));
const fromBn = (s) => s.replace(/\d/g, (d) => BN[Number(d)]);

let problems = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const locale = file.replace(/\.json$/, "");
  const p = path.join(DIR, file);
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const isBn = locale === "bn";
  const dec = (s) => (isBn ? toAscii(s) : s);
  const enc = (s) => (isBn ? fromBn(s) : s);

  // ---- terms.plansBody
  let body = data.terms && data.terms.plansBody;
  if (typeof body === "string" && !body.includes("{starter}")) {
    let s = dec(body);
    const seq = [[/250/, "{pro}"], [/100/, "{growth}"], [/50/, "{starter}"], [/20/, "{freeReplies}"], [/\b2\b/, "{freePosts}"]];
    let ok = true;
    for (const [re, rep] of seq) {
      const m = s.match(new RegExp(re.source, "g"));
      if (!m || m.length !== 1) { ok = false; break; }
      s = s.replace(re, rep);
    }
    if (ok) data.terms.plansBody = enc(s);
    else problems.push(locale + ": plansBody numbers not in expected 250/100/50/20/2 pattern - MANUAL CHECK");
  }

  // ---- pricing.count1 (e.g. 100 on Growth)
  let c1 = data.pricing && data.pricing.count1;
  if (typeof c1 === "string" && !c1.includes("{replies}")) {
    let s = dec(c1);
    const m = s.match(/\b100\b/g);
    if (m && m.length === 1) data.pricing.count1 = enc(s.replace(/\b100\b/, "{replies}"));
    else problems.push(locale + ": count1 has " + (m ? m.length : 0) + " x 100 - MANUAL CHECK");
  }

  // ---- landing.flow.limits.s4d (100-reply top-up)
  let s4 = data.landing && data.landing.flow && data.landing.flow.limits && data.landing.flow.limits.s4d;
  if (typeof s4 === "string" && !s4.includes("{topup}")) {
    let s = dec(s4);
    const m = s.match(/\b100\b/g);
    if (m && m.length === 1) data.landing.flow.limits.s4d = enc(s.replace(/\b100\b/, "{topup}"));
    else problems.push(locale + ": s4d has " + (m ? m.length : 0) + " x 100 - MANUAL CHECK");
  }

  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}
console.log("done");
if (problems.length) { console.log("PROBLEMS:"); problems.forEach((x) => console.log("  " + x)); process.exitCode = 1; }