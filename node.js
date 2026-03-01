const crypto = require('crypto');
const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// --- [ CONFIGURATION ] ---
const SERVER_URL = "https://puchain.pukmupee.com";
const PAGER_ID = "01-0001"; 
const THREADS = require('os').cpus().length; 
const CHECK_INTERVAL = 5000; // เช็ก Mempool ทุก 5 วินาที
const MINE_DELAY = 10000;    // เจอแล้วรอ 10 วินาทีค่อยเริ่มขุด

if (isMainThread) {
    console.clear();
    console.log("\x1b[41m\x1b[37m %s \x1b[0m", " 🦁 PUK@ LION MINER: REMOTE WATCHER V.2.1.1 ");
    console.log(`\x1b[33m[NODE]\x1b[0m ${SERVER_URL}`);
    console.log(`\x1b[33m[STATUS]\x1b[0m Listening for Transactions...\n`);

    async function checkRemoteMempool() {
        try {
            // เช็กผ่าน API ของ PUKChain โดยตรง
            const res = await axios.get(`${SERVER_URL}/get_mining_job`, { 
                params: { pager_id: PAGER_ID },
                timeout: 5000 
            });
            
            // ในระบบ PUKChain: ถ้า merkle_root ไม่ใช่ค่าว่าง หรือไม่ใช่ Default Hash 
            // แสดงว่ามี Transaction รอให้ขุดอยู่ใน Block นั้นครับ
            const hasTransactions = res.data.merkle_root && 
                                    res.data.merkle_root !== "0".repeat(64) &&
                                    res.data.merkle_root !== "bc5fb9935105... (ตัวอย่าง)"; // เช็กตาม Logic Server

            return { hasTx: true, job: res.data }; // ส่ง Job กลับไปเลยจะได้ไม่ต้องดึงซ้ำ
        } catch (e) {
            return { hasTx: false, job: null };
        }
    }

    async function monitor() {
        while (true) {
            const { hasTx, job } = await checkRemoteMempool();

            if (hasTx) {
                console.log(`\n\x1b[42m\x1b[30m 🎯 TX FOUND! \x1b[0m Mempool is active. Waiting ${MINE_DELAY/1000}s...`);
                
                // --- [ กฎเหล็ก: รอ 10 วินาที ] ---
                await new Promise(r => setTimeout(r, MINE_DELAY));

                // เริ่มขุดโดยใช้ Job ที่ดึงมาล่าสุด
                await startMining(job);
            } else {
                process.stdout.write(`\x1b[34m👂 Listening...\x1b[0m No tasks in mempool. \r`);
                await new Promise(r => setTimeout(r, CHECK_INTERVAL));
            }
        }
    }

    async function startMining(job) {
        const { idx, prev_hash, merkle_root, difficulty } = job;
        const targetPrefix = "0".repeat(difficulty);
        const bits = difficulty.toString(16).padStart(8, '0');

        console.log(`\x1b[36m[BLOCK #${idx}]\x1b[0m Mining started with ${THREADS} threads...`);

        return new Promise((resolve) => {
            const workers = [];
            let found = false;
            let totalHashes = 0;
            let startTime = Date.now();

            for (let i = 0; i < THREADS; i++) {
                const worker = new Worker(__filename, {
                    workerData: { idx, prev_hash, merkle_root, bits, targetPrefix }
                });

                worker.on('message', async (msg) => {
                    if (msg.type === 'found' && !found) {
                        found = true;
                        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                        console.log(`\n\x1b[45m\x1b[37m 💰 BLOCK MINED! \x1b[0m Time: ${duration}s | Nonce: ${msg.nonce}`);
                        
                        try {
                            const postRes = await axios.post(`${SERVER_URL}/mine`, {
                                pager_id: PAGER_ID,
                                nonce: parseInt(msg.nonce),
                                timestamp: msg.timestamp
                            });
                            console.log(`\x1b[32m[SERVER]\x1b[0m Result: ${postRes.data.message || "Success"}`);
                        } catch (e) {
                            console.log(`\x1b[31m[FAILED]\x1b[0m Block rejected by server.`);
                        }

                        workers.forEach(w => w.terminate());
                        resolve();
                    } else if (msg.type === 'stats') {
                        totalHashes += msg.count;
                    }
                });
                workers.push(worker);
            }
        });
    }

    monitor();

} else {
    // --- [ WORKER THREAD LOGIC ] ---
    const { idx, prev_hash, merkle_root, bits, targetPrefix } = workerData;
    const crypto = require('crypto');

    function doubleSha256(str) {
        const first = crypto.createHash('sha256').update(str).digest();
        return crypto.createHash('sha256').update(first).digest('hex');
    }

    let nonce = Math.floor(Math.random() * 0xFFFFFFFF);
    const vHex = idx.toString(16).padStart(8, '0');

    while (true) {
        nonce = (nonce + 1) % 0xFFFFFFFF;
        const ts = Math.floor(Date.now() / 1000);
        const header = `${vHex}${prev_hash}${merkle_root}${ts.toString(16).padStart(8, '0')}${bits}${nonce.toString(16).padStart(8, '0')}`;
        const hash = doubleSha256(header);
        
        if (hash.startsWith(targetPrefix)) {
            parentPort.postMessage({ type: 'found', nonce, timestamp: ts });
            break;
        }
        
        // ส่ง Stats ทุก 100,000 รอบเพื่อลด Overhead
        if (nonce % 100000 === 0) {
            parentPort.postMessage({ type: 'stats', count: 100000 });
        }
    }
}