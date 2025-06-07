// promisePool.js
// 建立一個簡單的 promise pool，限制同時執行數量
async function promisePool(tasks, concurrency) {
    const results = [];
    let i = 0;
    let running = 0;
    return new Promise((resolve, reject) => {
        function runNext() {
            if (i === tasks.length && running === 0) {
                resolve(results);
                return;
            }
            while (running < concurrency && i < tasks.length) {
                const currentIndex = i;
                const task = tasks[i++];
                running++;
                Promise.resolve()
                    .then(task)
                    .then(result => {
                        results[currentIndex] = result;
                        running--;
                        runNext();
                    })
                    .catch(err => {
                        reject(err);
                    });
            }
        }
        runNext();
    });
}

export default promisePool;
