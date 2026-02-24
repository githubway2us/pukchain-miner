const crypto = require('crypto');
const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// --- [ CONFIGURATION ] ---
const SERVER_URL = "https://puchain.pukmupee.com";
const PAGER_ID = "01-0001"; 
const THREADS = require('os').cpus().length; 

// ฟังก์ชันทำ Double SHA-256 ให้ตรงกับ Server Python
function doubleSha256(str) {
    const first = crypto.createHash('sha256').update(str).digest();
    return crypto.createHash('sha256').update(first).digest('hex');
}

if (isMainThread) {
    console.clear();
    console.log("\x1b[41m\x1b[37m %s \x1b[0m", " 🦁 PUK@ LION MINER: PRO-BLOCK HEADER V.2.0.0 ");
    console.log(`\x1b[33m[SYSTEM]\x1b[0m Node: ${SERVER_URL}`);
    console.log(`\x1b[33m[SYSTEM]\x1b[0m Threads: ${THREADS} Cores | Pager: ${PAGER_ID}\n`);
    
    let totalHashes = 0;
    let startTime = Date.now();

    async function startMining() {
        try {
            // 1. ดึง Mining Job (ต้องใช้ Merkle Root จาก Server)
            const res = await axios.get(`${SERVER_URL}/get_mining_job`, { params: { pager_id: PAGER_ID }, timeout: 5000 });
            const { idx, prev_hash, merkle_root, difficulty } = res.data;
            
            const targetPrefix = "0".repeat(difficulty);
            const bits = difficulty.toString(16).padStart(8, '0');
            const blockHeight = idx;

            console.log(`\x1b[36m[BLOCK #${blockHeight}]\x1b[0m Diff: ${difficulty} | Merkle: ${merkle_root.substring(0,10)}...`);

            const workers = [];
            let found = false;
            startTime = Date.now();
            totalHashes = 0;

            for (let i = 0; i < THREADS; i++) {
                const worker = new Worker(__filename, {
                    workerData: { idx, prev_hash, merkle_root, bits, targetPrefix }
                });

                worker.on('message', async (msg) => {
                    if (msg.type === 'found' && !found) {
                        found = true;
                        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                        console.log(`\n\n\x1b[42m\x1b[30m 💰 MINE SUCCESS! \x1b[0m Time: ${duration}s | Nonce: ${msg.nonce}`);
                        
                        // 2. ส่ง Nonce + Timestamp ไปยืนยัน (สำคัญมาก!)
                        try {
                            const postRes = await axios.post(`${SERVER_URL}/mine`, {
                                pager_id: PAGER_ID,
                                nonce: parseInt(msg.nonce),
                                timestamp: msg.timestamp // ส่งเวลาที่ใช้ขุดไปด้วย
                            });
                            console.log(`\x1b[32m[SERVER]\x1b[0m Success! Block Hash: ${postRes.data.block_hash.substring(0,16)}...`);
                        } catch (e) {
                            console.log(`\x1b[31m[REJECTED]\x1b[0m ${e.response ? JSON.stringify(e.response.data.detail) : "Timeout"}`);
                        }

                        workers.forEach(w => w.terminate());
                        setTimeout(startMining, 500); 
                    } else if (msg.type === 'stats') {
                        totalHashes += msg.count;
                    }
                });
                workers.push(worker);
            }

            const statsInterval = setInterval(() => {
                if (found) { clearInterval(statsInterval); return; }
                const elapsed = (Date.now() - startTime) / 1000;
                const hashrate = (totalHashes / elapsed).toFixed(0);
                process.stdout.write(`\x1b[34m⛏️  Mining...\x1b[0m Hashes: ${totalHashes.toLocaleString()} | Speed: ${(hashrate/1000).toFixed(1)} kH/s \r`);
            }, 1000);

        } catch (err) {
            console.log("\x1b[31m[ERROR]\x1b[0m Job sync failed. Retrying in 5s...");
            setTimeout(startMining, 5000);
        }
    }
    startMining();

} else {
    // --- [ WORKER THREAD LOGIC ] ---
    const { idx, prev_hash, merkle_root, bits, targetPrefix } = workerData;
    const crypto = require('crypto');

    function doubleSha256(str) {
        const first = crypto.createHash('sha256').update(str).digest();
        return crypto.createHash('sha256').update(first).digest('hex');
    }

    function mine() {
        let nonce = Math.floor(Math.random() * 0xFFFFFFFF);
        let localCount = 0;
        let lastTs = Math.floor(Date.now() / 1000);
        
        // แปลงค่าคงที่ไว้ก่อนเพื่อความเร็ว
        const vHex = idx.toString(16).padStart(8, '0');

        while (true) {
            nonce = (nonce + 1) % 0xFFFFFFFF;
            const ts = Math.floor(Date.now() / 1000);
            const tsHex = ts.toString(16).padStart(8, '0');
            const nHex = nonce.toString(16).padStart(8, '0');

            // Header: version + prev_hash + merkle_root + timestamp + bits + nonce
            const header = `${vHex}${prev_hash}${merkle_root}${tsHex}${bits}${nHex}`;
            const hash = doubleSha256(header);

            localCount++;
            
            if (hash.startsWith(targetPrefix)) {
                parentPort.postMessage({ 
                    type: 'found', 
                    nonce: nonce, 
                    timestamp: ts 
                });
                break;
            }

            if (localCount >= 10000) {
                parentPort.postMessage({ type: 'stats', count: localCount });
                localCount = 0;
            }
        }
    }
    mine();
}