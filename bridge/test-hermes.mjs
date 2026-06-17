import { Client } from 'ssh2';
import fs from 'fs';

const conn = new Client();
conn.on('ready', () => {
  // Step 1: kill + clean dbs
  conn.exec("killall -9 node 2>/dev/null; sleep 3; rm -f /root/codex-bridge-main/data/config.db*; echo step1_ok", () => {
    // Step 2: upload the reset script
    conn.sftp((err, sftp) => {
      if (err) { console.log('SFTP:', err); conn.end(); return; }
      
      const ws = sftp.createWriteStream('/tmp/full_reset.mjs');
      const script = `
import { DatabaseSync } from "node:sqlite";
import fs from "fs";

// 1. Clean admin.db config_kv
const adb = new DatabaseSync("/root/codex-bridge-main/data/admin.db");
adb.exec("PRAGMA journal_mode=WAL");
const keysToDelete = [
  "single_model_codex","single_model_hermes","single_model_neizhi",
  "abnormal_models","_abnormalModels","_providerHealth",
  "fallback_sequence","codex_fallback_sequence",
  "fallback_enabled","cond_switch_enabled",
  "_fallbackState","_countdown_start","_countdown_interval",
  "max_provider_use_minutes","builtin_reset_minutes"
];
for (const k of keysToDelete) {
  adb.prepare("DELETE FROM config_kv WHERE key = ?").run(k);
}
console.log("admin.db cleaned: " + keysToDelete.length + " keys");

// 2. Write clean config-proxy.json  
const cleanConfig = {
  single_model_codex: "shangtang2",
  single_model_hermes: "shangtang33",
  single_model_neizhi: "",
  fallback_enabled: true,
  cond_switch_enabled: true,
  builtin_reset_minutes: 5,
  max_provider_use_minutes: 96,
  fallback_sequence: "shangtang1;shangtang2;shangtang5;st44;ST40;z-ai2;shangtang4;shangtang3;ST41;st45;shangtang33;zhipu2;zhipu4;zhipu5;zhipu7;1;2;3;aliyun4;yidong;yidong2;google1;aliyun5;shangtang6;Cloud1;agnesai;modelscope;z-ai;st46;ST43;mianfei1;apifree;apifree2",
  codex_fallback_sequence: "shangtang1;shangtang2;shangtang5;st44;ST40;z-ai2;shangtang4;shangtang3;ST41;st45;shangtang33;zhipu2;zhipu4;zhipu5;zhipu7;1;2;3;aliyun4;yidong;yidong2;google1;aliyun5;shangtang6;Cloud1;agnesai;modelscope;z-ai;st46;ST43;mianfei1;apifree;apifree2",
  abnormal_models: [],
  disabled_builtins: ["mimo","deepseek","openai"],
  _fallbackState: { codexIdx: 1, hermesIdx: 10, lastSwitch: Date.now() }
};
fs.writeFileSync("/root/codex-bridge-main/config-proxy.json", JSON.stringify(cleanConfig, null, 2));
console.log("config written");
console.log("hermes:", cleanConfig.single_model_hermes);
`;
      ws.on('close', () => {
        sftp.end();
        console.log('script uploaded');
        
        // Step 3: run reset, then start service, then verify
        setTimeout(() => {
          conn.exec("node /tmp/full_reset.mjs; echo '---'; nohup /usr/bin/node --env-file=/root/codex-bridge-main/.env /root/codex-bridge-main/index.mjs >> /root/codex-bridge-main/data/luoda.log 2>&1 & echo started; sleep 15; echo '===15S==='; head -5 /root/codex-bridge-main/config-proxy.json; echo '===FB==='; curl -s http://localhost:40001/api/fallback 2>/dev/null | python3 -c \"import sys,json;d=json.load(sys.stdin);print('hl:',d.get('single_model_hermes'));print('hi:',d.get('_fallbackState',{}).get('hermesIdx'));print('ab:',len(d.get('abnormal_models',[])));print('cl:',d.get('single_model_codex'))\" 2>&1", (e, s) => {
            let o = '';
            s.on('data', d => o += d.toString());
            s.on('close', () => { console.log(o); conn.end(); });
          });
        }, 2000);
      });
      ws.end(script);
    });
  });
}).on('error', err => console.log('SSH:', err.message))
.connect({ host: '47.114.75.115', port: 22, username: 'root', password: 'Lkw-666999' });
