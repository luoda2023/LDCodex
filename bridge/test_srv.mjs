import http from "node:http";

const s1 = http.createServer((req, res) => {
  let b = "";
  req.on("data", c => b += c);
  req.on("end", () => {
    try { JSON.parse(b); res.end("OK1 len=" + b.length); }
    catch(e) { res.end("ERR1: " + e.message + " len=" + b.length); }
  });
});
s1.listen(40020, () => console.log("s1 up"));

const s2 = http.createServer(async (req, res) => {
  let b = "";
  try { for await (const chunk of req) { b += chunk; } }
  catch(e) { res.end("ERR2_STREAM: " + e.message); return; }
  try { JSON.parse(b); res.end("OK2 len=" + b.length); }
  catch(e) { res.end("ERR2: " + e.message + " len=" + b.length); }
});
s2.listen(40021, () => console.log("s2 up"));

const s3 = http.createServer(async (req, res) => {
  const bodyPromise = (async () => {
    let b = "";
    try { for await (const chunk of req) { b += chunk; } }
    catch(e) { console.log("FA catch:", e.message); }
    return b;
  })();
  await new Promise(r => setTimeout(r, 100));
  const b = await bodyPromise;
  try { JSON.parse(b); res.end("OK3 len=" + b.length); }
  catch(e) { res.end("ERR3: " + e.message + " len=" + b.length); }
});
s3.listen(40022, () => console.log("s3 up"));
