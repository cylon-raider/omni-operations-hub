// -----------------------------------------------------------------------------
// tally.js (Debug Script)
// -----------------------------------------------------------------------------
// This is a standalone Node.js script used to manually test and debug the
// outbound call counting logic. It is not part of the active cloud functions.
// -----------------------------------------------------------------------------
const fs = require('fs');

async function test() {
    const res = await fetch("https://debugdb-tckilgaywa-uc.a.run.app");
    const data = await res.json();
    const calls = data.calls.filter(c => {
        // Only today (Aug 5)
        const sec = c.createdAt?._seconds;
        if (!sec || sec < 1785913200 || sec >= 1785999600) return false;

        let isOutbound = false;
        if (c.direction === 'outbound') {
            isOutbound = true;
        } else if (c.direction === 'inbound') {
            return false;
        }

        if (!isOutbound && c.rawEvent && typeof c.rawEvent === 'string') {
            const match = c.rawEvent.match(/"direction"\s*:\s*"([^"]+)"/i);
            if (match && match[1]) {
                const dir = match[1].toLowerCase();
                if (dir === 'outbound') isOutbound = true;
                else if (dir === 'inbound') return false;
            }
        }

        if (!isOutbound) {
            if (c.isOutbound === true) {
                isOutbound = true;
            } else {
                const n = (c.fromName || c.name || '').toLowerCase();
                if (n.includes('family dental') && !n.includes('provider')) {
                    isOutbound = true;
                }
            }
        }

        return isOutbound;
    });

    const tallies = {};
    const aliases = {
        'devon': 'DEVIN',
        'alacia': 'ALICIA',
        'iliana': 'EYLIANNA',
        'aliana': 'EYLIANNA',
        'eliana': 'EYLIANNA',
        'alicia': 'ALESSIA',
        'lisa': 'ALESSIA',
        'mara': 'MARAH',
        'mary ann': 'MARIANNE',
        'b': 'IGNORE',
        'bea': 'IGNORE',
        'tim': 'IGNORE'
    };

    calls.forEach(c => {
        let rawName = (c.employeeName || '').toLowerCase().trim();
        let empName = rawName;
        if (aliases[rawName]) {
            if (aliases[rawName] === 'IGNORE') return;
            empName = aliases[rawName].toLowerCase();
        }
        if (!empName) return;
        tallies[empName] = (tallies[empName] || 0) + 1;
    });

    console.log(tallies);
}

test();
