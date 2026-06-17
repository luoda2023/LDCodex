/**
 * Minimal echo server to debug body parsing on VPS
 */
import http from "node:http";

const s = http.createServer(async (req, res) => {
  console.log("GOT:", req.method, req.url);
  let body = "";
  try {
    for await (const chunk of req) {
      body += chunk;
    }
  } catch(e) {
    console.log("STREAM_ERR:", e.message);
  }
  console.log("BODY_LEN:", body.length);
  console.log("BODY:", JSON.stringify(body).slice(0, 200));
  
  try {
    JSON.parse(body);
    res.end("OK");
  } catch(e) {
    console.log("PARSE_ERR:", e.message);
    res.end("ERR_JSON: " + e.message);
  }
});

s.listen(40005, () => console.log("DEBUG_SERVER on 40005"));
