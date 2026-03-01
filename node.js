const crypto = require('crypto');
const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// --- [ CONFIGURATION ] ---
const SERVER_URL = "https://puchain.pukmupee.com";
const PAGER_ID = "01-0001"; 
const THREADS = require('os').cpus().length; 
const CHECK_INTERVAL = 5000; // เช็ก Mempool ทุก 5 วินาที
const MINE_DELAY = 10000;    // เจอ TX แล้วรอ 10 วินาทีให้คนส่งเพิ่มค่อยเริ่มขุด

if (isMainThread) {
    console.clear();
    console.log("\x1b[41m\x1b[37m %s \x1b[0m", " 🦁 PUK@ LION MINER: EVENT-DRIVEN V.2.1.2 ");
    console.log(`\x1b[33m[NODE]\x1b[0m ${SERVER_URL} | \x1b[33m[THREADS]\x1b[0m ${THREADS}`);
    console.log(`\x1b[32m[LOGIC]\x1b[0m No TX, No Mine. Standing by...\n`);

    async function getJob() {
        try {
            const res = await axios.get(`${SERVER_URL}/get_mining_job`, { 
                params: { pager_id: PAGER_ID },
                timeout: 5000 
            });
            return res.data;
        } catch (e) {
            return null;
        }
    }

    async function monitor() {
        while (true) {
            const job = await getJob();
            
            // Logic เช็กว่ามีธุรกรรมหรือไม่: Merkle Root ต้องไม่เป็นค่าว่าง (0ล้วน)
            const emptyRoot = "0".repeat(64);
            const hasTx = job && job.merkle_root && job.merkle_root !== emptyRoot;

            if (hasTx) {
                console.log(`\n\x1b[42m\x1b[30m 🎯 TX DETECTED! \x1b[0m Merkle: ${job.merkle_root.substring(0,12)}...`);
                console.log(`\x1b[33m[WAIT]\x1b[0m Buffering transactions for ${MINE_DELAY/1000}s...`);
                
                // รอ 10 วินาทีตามใจบรรพบุรุษ
                await new Promise(r => setTimeout(r, MINE_DELAY));

                // *** สำคัญ: ต้องดึง Job ใหม่หลังรอเสร็จ เพราะ prev_hash อาจเปลี่ยนไปแล้ว ***
                process.stdout.write(`\x1b[36m[SYNC]\x1b[0m Fetching fresh job... `);
                const freshJob = await getJob();
                
                if (freshJob && freshJob.merkle_root !== emptyRoot) {
                    console.log(`Ready! Block #${freshJob.idx}`);
                    await startMining(freshJob);
                } else {
                    console.log(`Cancelled (Mempool cleared or Error).`);
                }
            } else {
                // ถ้าไม่เจอธุรกรรม แค่แสดงสถานะ Listening แล้ววนต่อ (ไม่สั่งขุด)
                process.stdout.write(`\x1b[34m👂 Listening...\x1b[0m Mempool empty. Standing by... \r`);
                await new Promise(r => setTimeout(r, CHECK_INTERVAL));
            }
        }
    }

    async function startMining(job) {
        const { idx, prev_hash, merkle_root, difficulty } = job;
        const targetPrefix = "0".repeat(difficulty);
        const bits = difficulty.toString(16).padStart(8, '0');

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
                        console.log(`\n\x1b[45m\x1b[37m 💰 BLOCK SUCCESS! \x1b[0m Time: ${duration}s | Nonce: ${msg.nonce}`);
                        
                        try {
                            const postRes = await axios.post(`${SERVER_URL}/mine`, {
                                pager_id: PAGER_ID,
                                nonce: parseInt(msg.nonce),
                                timestamp: msg.timestamp
                            });
                            console.log(`\x1b[32m[SERVER]\x1b[0m ${postRes.data.message || "Block Accepted"}`);
                        } catch (e) {
                            console.log(`\x1b[31m[FAILED]\x1b[0m Block stale or rejected.`);
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
    // --- [ WORKER THREAD LOGIC - CORE MINING ] ---
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
        
        if (nonce % 100000 === 0) {
            parentPort.postMessage({ type: 'stats', count: 100000 });
        }
    }
}