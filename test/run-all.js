/**
 * Run all tests
 * Usage: node test/run-all.js
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const testFiles = [
    'newtab.test.js',
    'favicon-cache.test.js'
];

let totalPassed = 0;
let totalFailed = 0;
let testsCompleted = 0;

function runTest(testFile) {
    return new Promise((resolve) => {
        const testPath = path.join(__dirname, testFile);
        const child = spawn('node', [testPath], {
            stdio: ['inherit', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
            process.stdout.write(data);
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
            process.stderr.write(data);
        });

        child.on('close', (code) => {
            // Parse results from output
            const match = stdout.match(/Results: (\d+) passed, (\d+) failed/);
            if (match) {
                totalPassed += parseInt(match[1], 10);
                totalFailed += parseInt(match[2], 10);
            }
            resolve(code);
        });
    });
}

async function runAllTests() {
    console.log('='.repeat(60));
    console.log('Running all tests...');
    console.log('='.repeat(60));
    console.log('');

    for (const testFile of testFiles) {
        console.log('-'.repeat(60));
        console.log(`Running: ${testFile}`);
        console.log('-'.repeat(60));
        await runTest(testFile);
        console.log('');
    }

    console.log('='.repeat(60));
    console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
    console.log('='.repeat(60));

    process.exit(totalFailed > 0 ? 1 : 0);
}

runAllTests();

