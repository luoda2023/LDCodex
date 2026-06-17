/**
 * Minimal test: directly compare data/end vs for-await-of
 */
import http from "node:http";

const s = http.createServer((req, res) => {
  console.log("GOT:", req.method, req.url);
  console.log("readableEnded:", req.readableEnded);
  console.log("readableFlowing:", req.readableFlowing);
  
  // Collect body with old-school events
  let body1 = "";
  req.on("data", (c) => { body1 += c; });
  req.on("end", () => {
    console.log("METHOD1 body:", JSON.stringify(body1));
    console.log("METHOD1 len:", body1.length);
    
    try {
      JSON.parse(body1);
      res.end("OK:" + body1.length);
    } catch(e) {
      res.end("PARSE_ERR:" + e.message);
    }
  });
  req.on("error", (e) => {
    console.log("STREAM_ERR:", e.message);
  });
});

s.listen(40008, () => console.log("LISTEN_ON_40008"));
