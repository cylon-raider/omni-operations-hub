const fetch = require('node-fetch');

async function run() {
    let calls = [];
    let pageToken = '';
    
    console.log("Fetching from REST API...");
    do {
        const url = `https://firestore.googleapis.com/v1/projects/fds-operations-hub/databases/(default)/documents/artifacts/fds-operations-hub/public/data/calls?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.documents) {
            data.documents.forEach(doc => {
                const call = { id: doc.name.split('/').pop() };
                for (const key in doc.fields) {
                    if (doc.fields[key].stringValue !== undefined) call[key] = doc.fields[key].stringValue;
                    else if (doc.fields[key].booleanValue !== undefined) call[key] = doc.fields[key].booleanValue;
                    else if (doc.fields[key].integerValue !== undefined) call[key] = parseInt(doc.fields[key].integerValue, 10);
                    else if (doc.fields[key].timestampValue !== undefined) {
                        call[key] = {
                            toMillis: () => new Date(doc.fields[key].timestampValue).getTime()
                        };
                    }
                }
                calls.push(call);
            });
        }
        
        pageToken = data.nextPageToken;
    } while (pageToken);

    console.log(`Fetched ${calls.length} total calls.`);

    const start = new Date("2026-08-05T00:00:00-07:00").getTime();
    const end = new Date("2026-08-06T00:00:00-07:00").getTime();

    // Filter today's calls
    const todaysCalls = calls.filter(c => {
        if (!c.createdAt || !c.createdAt.toMillis) return false;
        const time = c.createdAt.toMillis();
        return time >= start && time < end;
    });

    console.log(`Found ${todaysCalls.length} calls for August 5th.`);

    const outboundCalls = todaysCalls.filter((c) => {
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
          if ((n.includes('family dental') || n.includes('chewy dental')) && !n.includes('provider')) {
            isOutbound = true;
          }
        }
      }

      return isOutbound;
    });
    
    console.log(`Total outbound calls today: ${outboundCalls.length}`);

    const NAME_ALIASES = {
      'devon': 'DEVIN', 'alacia': 'ALICIA', 'iliana': 'EYLIANNA',
      'aliana': 'EYLIANNA', 'eliana': 'EYLIANNA', 'alicia': 'ALESSIA',
      'lisa': 'ALESSIA', 'mara': 'MARAH', 'mary ann': 'MARIANNE',
      'b': 'IGNORE', 'bea': 'IGNORE', 'tim': 'IGNORE'
    };

    const tallies = {};
    let blankCount = 0;
    
    outboundCalls.forEach(c => {
      const rawName = (c.employeeName || '').toLowerCase().trim();
      if (!rawName || rawName === 'unknown') {
          blankCount++;
          return;
      }
      
      let empName = rawName;
      if (NAME_ALIASES[rawName]) {
        if (NAME_ALIASES[rawName] === 'IGNORE') return;
        empName = NAME_ALIASES[rawName].toLowerCase();
      }
      
      tallies[empName] = (tallies[empName] || 0) + 1;
    });

    console.log("Tallies:", tallies);
    console.log("Missing/Blank names:", blankCount);
}

run().catch(console.error);
