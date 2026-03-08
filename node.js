const crypto = require('crypto');
const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// ------------------ CONFIG ------------------
const SERVER_URL = "http://localhost:8139";
const DIFFICULTY = "000";
const THREADS = require('os').cpus().length;

// --- ส่วนที่เพิ่มใหม่: ระบบสุ่มแจก ---
const MAX_MACHINES = 50;          // จำนวนเครื่องที่จะสุ่ม (เช่น 01-0001 ถึง 01-0050)
const RANDOM_AMOUNT = 10.5;       // ยอดเงินที่จะส่ง (ถ้า API รองรับการส่ง amount)
// -------------------------------------------

const MINING_ROUND_TIME = 1500; 
const HOURS = 60 * 60 * 1000;
const MEMPOOL_CHECK_INTERVAL = 10000; // ปรับเป็น 10 วินาทีเพื่อให้เห็นผลไวขึ้น

// ฟังก์ชันสุ่ม Pager ID
function generateRandomPagerId() {
    const randomNum = Math.floor(Math.random() * MAX_MACHINES) + 1;
    const paddedNum = String(randomNum).padStart(4, '0');
    return `01-${paddedNum}`;
}

if (isMainThread) {
    console.clear();
    console.log("\x1b[41m\x1b[37m  PUKCHAIN MULTI-MINER SIMULATOR  \x1b[0m");
    console.log(`\x1b[33mMax Machines:\x1b[0m ${MAX_MACHINES} | \x1b[36mCores:\x1b[0m ${THREADS}`);

    let totalHashes = 0;
    let isActive = true;
    let isMining = false;
    let miningWorkers = [];
    let mempoolCheckTimer = null;

    async function checkAndDecideMining() {
        try {
            const res = await axios.get(`${SERVER_URL}/mempool_status`);
            const hasTx = res.data.has_pending_tx || false;
            const count = res.data.pending_count || 0;

            console.log(`\x1b[35m[Mempool]\x1b[0m Pending TX: ${count}`);

            if (hasTx) {
                startMiningIfNotActive();
            } else {
                stopMiningIfActive();
            }
        } catch (err) {
            console.log("\x1b[31mMempool check failed\x1b[0m", err.message);
            stopMiningIfActive();
        }
    }

    function startMiningIfNotActive() {
        if (isMining || !isActive) return;
        isMining = true;

        // สุ่ม Pager ID ใหม่ทุกครั้งที่เริ่มขุดรอบใหม่
        const currentPagerId = generateRandomPagerId();
        console.log(`\x1b[42m START \x1b[0m Mining for: \x1b[33m${currentPagerId}\x1b[0m | Amount: \x1b[32m${RANDOM_AMOUNT}\x1b[0m`);

        axios.get(`${SERVER_URL}/get_last_hash`)
            .then(res => {
                const lastHash = res.data.hash || '0'.repeat(64);
                miningWorkers = [];
                let found = false;

                for (let i = 0; i < THREADS; i++) {
                    const w = new Worker(__filename, {
                        workerData: { lastHash, pagerId: currentPagerId, difficulty: DIFFICULTY }
                    });

                    w.on('message', async (msg) => {
                        if (msg.type === 'found' && !found && isActive) {
                            found = true;
                            console.log(`\x1b[44m FOUND \x1b[0m By ${currentPagerId} | Nonce: ${msg.nonce}`);

                            try {
                                const submit = await axios.post(`${SERVER_URL}/mine`, {
                                    pager_id: currentPagerId,
                                    nonce: msg.nonce,
                                    amount: RANDOM_AMOUNT // ส่งยอดเงินไปด้วย
                                });
                                console.log(`\x1b[32m[SERVER]\x1b[0m Success! Block recorded.`);
                            } catch (e) {
                                console.log("\x1b[31mSubmit failed\x1b[0m", e.message);
                            }

                            stopMiningIfActive();
                            setTimeout(checkAndDecideMining, MINING_ROUND_TIME);
                        } else if (msg.type === 'stats') {
                            totalHashes += msg.count;
                        }
                    });
                    miningWorkers.push(w);
                }
            })
            .catch(err => {
                stopMiningIfActive();
                setTimeout(checkAndDecideMining, 5000);
            });
    }

    function stopMiningIfActive() {
        if (!isMining) return;
        isMining = false;
        miningWorkers.forEach(w => w.terminate());
        miningWorkers = [];
        console.log("\x1b[33mMining paused\x1b[0m");
    }

    checkAndDecideMining();
    mempoolCheckTimer = setInterval(checkAndDecideMining, MEMPOOL_CHECK_INTERVAL);

    process.on('SIGINT', () => {
        isActive = false;
        clearInterval(mempoolCheckTimer);
        stopMiningIfActive();
        process.exit(0);
    });

} else {
    const { lastHash, pagerId, difficulty } = workerData;
    let count = 0;
    while (true) {
        const nonce = Math.floor(Math.random() * 1e16).toString();
        const input = pagerId + lastHash + nonce;
        const hash = crypto.createHash('sha256').update(input).digest('hex');
        count++;
        if (hash.startsWith(difficulty)) {
            parentPort.postMessage({ type: 'found', nonce });
            break;
        }
        if (count >= 50000) {
            parentPort.postMessage({ type: 'stats', count });
            count = 0;
        }
    }
}