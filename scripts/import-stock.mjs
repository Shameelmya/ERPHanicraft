import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openStore} from '../local/store.mjs';
import {initialiseClean,importCatalogue} from '../local/catalogue.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/import-stock.mjs "path/to/stock.csv"');
const s=openStore(process.env.HANICRAFT_DB||resolve('data/hanicraft-live.sqlite'));initialiseClean(s);const result=importCatalogue(s,readFileSync(process.argv[2],'utf8'));s.close();console.log(JSON.stringify({entries:result.itemCount,uniqueCodes:result.uniqueCodes,duplicateCodes:result.duplicateCodes}));
