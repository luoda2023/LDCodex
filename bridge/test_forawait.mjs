import http from "node:http";

const s = http.createServer(async (req, res) => {
  let body = "";
  try {
    for await (const chunk of req) {
      body += chunk;
    }
    console.log("SUCCESS body=", body.length);
    console.log("BODY:", JSON.stringify(body).slice(0,100));
    try {
      JSON.parse(body);
      res.end("OK");
    } catch(e) {
      console.log("PARSE ERR:", e.message);
      res.end("PARSE_ERR:" + e.message);
    }
  } catch(e) {
    console.log("FOR_AWAIT_ERR:", e.message);
    console.log("STACK:", e.stack);
    res.end("FOR_AWAIT_ERR:" + e.message);
  }
});

s.listen(40030, () => console.log("TEST_SRV on 40030"));
