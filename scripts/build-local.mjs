import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
for(const f of ['local/attendance.mjs','local/catalogue.mjs','local/metrics.mjs','local/store.mjs','local/seed.mjs','local/business.mjs','local/server.mjs','public/attendance-ui.js','public/executive-ui.js','public/catalogue-ui.js','public/app.js','public/ui.js','public/screens.js','public/forms.js'])execFileSync(process.execPath,['--check',f],{stdio:'inherit'});
for(const f of ['public/index.html','public/styles.css','public/logo.png','public/icons.js'])if(!existsSync(f))throw new Error('Missing asset: '+f);
console.log('Local application: syntax and required assets verified.');
