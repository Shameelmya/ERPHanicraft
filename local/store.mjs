import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
export const uid=()=>randomUUID();
export const now=()=>new Date().toISOString();
export const digest=x=>createHash('sha256').update(x).digest('hex');
export function hashPassword(password){const salt=uid();return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function checkPassword(password,hash){const [salt,key]=hash.split(':');return timingSafeEqual(Buffer.from(key,'hex'),scryptSync(password,salt,64));}
export function openStore(path){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Audit events are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Audit events are immutable'); END;
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS receipts(actor TEXT,key TEXT,hash TEXT,result TEXT,PRIMARY KEY(actor,key));
 CREATE INDEX IF NOT EXISTS records_kind ON records(kind);`);
 const statements=new Map(),cache=new Map();let changes=new Map(),revision=0;
 const prepared=sql=>{if(!statements.has(sql))statements.set(sql,db.prepare(sql));return statements.get(sql);};
 db.exec(`CREATE INDEX IF NOT EXISTS records_sort ON records(kind,json_extract(data,'$.createdAt') DESC,id DESC); CREATE INDEX IF NOT EXISTS events_entity ON events(json_extract(data,'$.entityId')); CREATE INDEX IF NOT EXISTS events_order ON events(json_extract(data,'$.orderId')); CREATE INDEX IF NOT EXISTS records_email ON records(kind,json_extract(data,'$.email'));`);
 const api={db,prepared,get revision(){return revision;},get changes(){return [...changes.values()];},
  list(kind){if(!cache.has(kind))cache.set(kind,prepared('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.data)));return structuredClone(cache.get(kind));},
  get:(kind,id)=>{const r=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.data):null;},
  put(kind,row){const old=api.get(kind,row.id);const next={...row,id:row.id||uid(),createdAt:old?.createdAt||row.createdAt||now(),updatedAt:now(),version:(old?.version||0)+1};prepared('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,next.id,JSON.stringify(next));const key=kind+':'+next.id;changes.set(key,{kind,id:next.id,before:changes.has(key)?changes.get(key).before:old,after:next});cache.delete(kind);revision++;return next;},
  remove(kind,id){const old=api.get(kind,id);prepared('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);changes.set(kind+':'+id,{kind,id,before:old,after:null});cache.delete(kind);revision++;},
  page(kind,{where='1',args=[],q='',status='',size=12,cursor}={}){let sql='kind=? AND ('+where+')';const params=[kind,...args];if(q){sql+=' AND lower(data) LIKE ? ESCAPE \'!\'';params.push('%'+q.toLowerCase().replace(/[!%_]/g,'!$&')+'%');}if(status){const ss=status.split(',');sql+=" AND json_extract(data,'$.status') IN ("+ss.map(()=>'?').join(',')+')';params.push(...ss);}const total=prepared('SELECT count(*) AS n FROM records WHERE '+sql).get(...params).n;if(cursor){const c=api.get(kind,cursor);if(!c)throw Object.assign(new Error('List changed. Start from the first page.'),{status:409});sql+=" AND (json_extract(data,'$.createdAt'),id) < (?,?)";params.push(c.createdAt,c.id);}const rows=prepared("SELECT data FROM records WHERE "+sql+" ORDER BY json_extract(data,'$.createdAt') DESC,id DESC LIMIT ?").all(...params,size+1).map(r=>JSON.parse(r.data));const more=rows.length>size;rows.length=Math.min(rows.length,size);return {rows,total,next:more?rows.at(-1).id:null};},
  events:()=>db.prepare('SELECT data FROM events ORDER BY seq DESC').all().map(r=>JSON.parse(r.data)),
  event(e){const row={id:uid(),at:now(),...e};db.prepare('INSERT INTO events(id,data) VALUES(?,?)').run(row.id,JSON.stringify(row));revision++;return row;},
  transaction(fn){db.exec('BEGIN IMMEDIATE');changes=new Map();try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');cache.clear();changes.clear();revision++;throw e;}},
  close:()=>db.close()
 };return api;
}
