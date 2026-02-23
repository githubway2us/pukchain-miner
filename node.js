const crypto = require('crypto');
const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// --- [ CONFIGURATION ] ---
const SERVER_URL = "https://puchain.pukmupee.com";
const PAGER_ID = "01-0001"; // Pager ID ของเรา
const THREADS = require('os').cpus().length; 

if (isMainThread) {
    console.clear();
    console.log("\x1b[41m\x1b[37m %s \x1b[0m", " 🦁 PUK@ LION MINER: DYNAMIC EDITION V.1.0.1 ");
    console.log(`\x1b[33m[SYSTEM]\x1b[0m Node: ${SERVER_URL}`);
    console.log(`\x1b[33m[SYSTEM]\x1b[0m Threads: ${THREADS} Cores | Pager: ${PAGER_ID}\n`);
    
    let totalHashes = 0;
    let startTime = Date.now();

    async function startMining() {
        try {
            // 1. ดึงข้อมูล Mining Info (Hash ล่าสุด และ ความยากปัจจุบัน)
            // Boss ต้องแน่ใจว่าสร้าง API /mining_info ไว้ที่ฝั่ง Python แล้วนะครับ
            const res = await axios.get(`${SERVER_URL}/mining_info`, { timeout: 5000 });
            const { last_hash, difficulty, block_height } = res.data;
            const targetPrefix = "0".repeat(difficulty); // สร้างเงื่อนไขความยาก เช่น "0000"

            console.log(`\x1b[36m[BLOCK #${block_height}]\x1b[0m Difficulty: ${difficulty} (${targetPrefix})`);
            console.log(`\x1b[90m[LAST HASH]\x1b[0m ${last_hash.substring(0, 32)}...`);

            const workers = [];
            let found = false;
            startTime = Date.now();
            totalHashes = 0;

            for (let i = 0; i < THREADS; i++) {
                const worker = new Worker(__filename, {
                    workerData: { lastHash: last_hash, PAGER_ID, targetPrefix }
                });

                worker.on('message', async (msg) => {
                    if (msg.type === 'found' && !found) {
                        found = true;
                        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                        console.log(`\n\n\x1b[42m\x1b[30m 💰 MINE SUCCESS! \x1b[0m Time: ${duration}s | Nonce: ${msg.nonce}`);
                        
                        // 2. ส่ง Nonce ไปยืนยัน
                        try {
                            const postRes = await axios.post(`${SERVER_URL}/mine`, {
                                pager_id: PAGER_ID,
                                nonce: msg.nonce
                            }, { timeout: 10000 });
                            
                            console.log(`\x1b[32m[SERVER]\x1b[0m ${postRes.data.message} | Reward: ${postRes.data.reward} PUK`);
                        } catch (e) {
                            console.log(`\x1b[31m[ERROR]\x1b[0m ${e.response ? e.response.data.detail : "Server Timeout"}`);
                        }

                        // หยุดทุก Thread และเริ่มบล็อกถัดไป
                        workers.forEach(w => w.terminate());
                        setTimeout(startMining, 1000); // พัก 1 วิแล้วเริ่มต่อ
                    } else if (msg.type === 'stats') {
                        totalHashes += msg.count;
                    }
                });
                workers.push(worker);
            }

            // แสดงสถานะการขุด
            const statsInterval = setInterval(() => {
                if (found) { clearInterval(statsInterval); return; }
                const elapsed = (Date.now() - startTime) / 1000;
                const hashrate = (totalHashes / elapsed).toFixed(0);
                process.stdout.write(`\x1b[34m⛏️  Mining...\x1b[0m Hashes: ${totalHashes.toLocaleString()} | Speed: ${Number(hashrate).toLocaleString()} H/s \r`);
            }, 1000);

        } catch (err) {
            console.log("\x1b[31m[OFFLINE]\x1b[0m Sync failed. Retrying in 5s...");
            setTimeout(startMining, 5000);
        }
    }

    startMining();

} else {
    // --- [ WORKER THREAD LOGIC ] ---
    const { lastHash, PAGER_ID, targetPrefix } = workerData;
    let localCount = 0;

    function mine() {
        // สุ่ม Nonce เริ่มต้นเพื่อไม่ให้แต่ละ Thread ขุดซ้ำกัน
        let nonce = Math.floor(Math.random() * 1e15); 

        while (true) {
            nonce++;
            const dataString = `${PAGER_ID}${lastHash}${nonce}`;
            const hash = crypto.createHash('sha256').update(dataString).digest('hex');

            localCount++;
            
            if (hash.startsWith(targetPrefix)) {
                parentPort.postMessage({ type: 'found', nonce: nonce.toString() });
                break;
            }

            // ส่งข้อมูลกลับไปอัปเดต Hashrate ทุกๆ 50,000 hashes (ปรับให้ไวขึ้นเพื่อให้ UI ลื่น)
            if (localCount >= 50000) {
                parentPort.postMessage({ type: 'stats', count: localCount });
                localCount = 0;
            }
        }
    }
    mine();
}