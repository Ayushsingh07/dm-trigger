const fs=require("fs");
const j=JSON.parse(fs.readFileSync("locales/hi.json","utf8"));
for(const [k,v] of Object.entries(j.lang)){
  console.log(k, [...v].map(c=>c+"(U+"+c.codePointAt(0).toString(16).toUpperCase()+")").join(" "));
}
