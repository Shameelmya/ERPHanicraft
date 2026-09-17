import {metrics,operations} from './metrics.mjs';
import {attendanceView,payrollPreview,todayIST,validMonth} from './attendance.mjs';
import http from 'node:http';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openStore,checkPassword,digest,now} from './store.mjs';
import {seed} from './seed.mjs';
import {initialiseClean,stockCapacity,replenishmentShortage} from './catalogue.mjs';
import {command,records,report,can,RIGHTS,ROLES,CENTRES,publicUser,AppError} from './business.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export function createApp({database=process.env.HANICRAFT_DB||resolve(root,'data/hanicraft-live.sqlite'),source=resolve(root,'../work/stock_analysis.json'),reviewSeed=false}={}){
 const store=openStore(database);if(reviewSeed)seed(store,source);else initialiseClean(store);const limits=new Map(),responseCache=new Map(),staticCache=new Map();
 const cached=(key,fn)=>{const k=store.revision+':'+key;if(responseCache.has(k))return responseCache.get(k);if(responseCache.size>300)responseCache.clear();const value=fn();responseCache.set(k,value);return value;};
 function page(u,kind,options={}){records(store,u,kind,[]);let where='1',args=[];if(kind==='notifications'&&!['MD','GM'].includes(u.role)){where="(json_extract(data,'$.userId')=? OR json_extract(data,'$.role')=?)";args=[u.id,u.role];}if(kind==='tasks'&&!can(u,'assign')){where="json_extract(data,'$.assigneeId')=?";args=[u.id];}if(kind==='tasks'&&u.role==='Finishing Supervisor'){where="json_extract(data,'$.stage') IN (?,?,?,?)";args=CENTRES;}if(kind==='assignments'&&u.role==='Finishing'){where="json_extract(data,'$.employeeId')=?";args=[u.id];}if(kind==='orders'&&u.role==='Dispatch')where="json_extract(data,'$.status') IN ('READY','DISPATCHED')";if(kind==='products'&&options.activeOnly)where="json_extract(data,'$.active')=1";if(kind==='audit'){const total=store.db.prepare('SELECT count(*) AS n FROM events').get().n;const cursor=options.cursor?store.db.prepare('SELECT seq FROM events WHERE id=?').get(options.cursor)?.seq:null;const rows=store.db.prepare('SELECT data FROM events WHERE seq<? ORDER BY seq DESC LIMIT ?').all(cursor||Number.MAX_SAFE_INTEGER,(options.size||12)+1).map(r=>JSON.parse(r.data));const more=rows.length>(options.size||12);rows.length=Math.min(rows.length,options.size||12);return {rows,total,next:more?rows.at(-1).id:null};}const result=store.page(kind,{...options,where,args});result.rows=records(store,u,kind,result.rows);if(kind==='products')result.rows=result.rows.map(p=>({...p,shortage:replenishmentShortage(store,p)}));return result;} 
 const server=http.createServer(async(req,res)=>{
  const host=req.headers.host||'';if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)){res.writeHead(403);res.end('Local access only');return;}
  const origin='http://'+host;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  try{
   const url=new URL(req.url,origin),path=url.pathname;
   if(path.startsWith('/api/')){
    if(!['GET','POST'].includes(req.method))throw new AppError('Method not allowed',405);
    let body={};if(req.method==='POST'){
     if(req.headers.origin!==origin)throw new AppError('Request origin rejected.',403);
     if(!(req.headers['content-type']||'').startsWith('application/json'))throw new AppError('JSON body required.',415);
     let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>256000)throw new AppError('Request is too large.',413);}try{body=JSON.parse(data);}catch{throw new AppError('Invalid JSON.');}
    }
    if(path==='/api/health'){send({ok:true,mode:'local-review',database:'SQLite',time:now()});return;}
    if(path==='/api/login-users'&&req.method==='GET'){send({users:store.list('employees').filter(employee=>employee.active).sort((a,b)=>a.role.localeCompare(b.role)||a.name.localeCompare(b.name)).map(employee=>({id:employee.id,name:employee.name,email:employee.email,role:employee.role,title:employee.title||employee.role}))});return;}
    if(path==='/api/login'&&req.method==='POST'){
     const email=String(body.email||'').toLowerCase().trim();const key=(req.socket.remoteAddress||'')+':'+email;
     const rate=limits.get(key)||{count:0,until:Date.now()+60000};if(Date.now()>rate.until){rate.count=0;rate.until=Date.now()+60000;}rate.count++;limits.set(key,rate);if(limits.size>1000)limits.clear();if(rate.count>10)throw new AppError('Too many attempts. Try again in one minute.',429);
     const account=store.prepared("SELECT data FROM records WHERE kind='employees' AND json_extract(data,'$.email')=?").get(email);const e=account?JSON.parse(account.data):null;
     if(!e?.active||typeof body.password!=='string'||body.password.length>200||!checkPassword(body.password,e.passwordHash)){store.event({actorId:null,actorName:'Sign-in',action:'login_failed',entityKind:'security',entityId:email});throw new AppError('Email or password is incorrect, or this account is disabled.',401);}
     const token=randomBytes(32).toString('hex');store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());store.db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(digest(token),e.id,Date.now()+8*3600000);
     res.setHeader('Set-Cookie','hani_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');store.event({actorId:e.id,actorName:e.name,action:'login',entityKind:'security',entityId:e.id});send({user:publicUser(e)});return;
    }
    const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(c=>c.startsWith('hani_session='))?.slice(13);const session=token?store.db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(digest(token),Date.now()):null;
    const u=session?store.get('employees',session.user_id):null;if(!u?.active)throw new AppError('Please sign in to continue.',401);
    if(path==='/api/logout'&&req.method==='POST'){store.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie','hani_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send({ok:true});return;}
    if(path==='/api/revision'&&req.method==='GET'){send({revision:store.revision});return;}
    if(path==='/api/attendance'&&req.method==='GET'){const month=validMonth(url.searchParams.get('month')||todayIST().slice(0,7)),employeeId=url.searchParams.get('employeeId')||'';send(cached(u.id+':attendance:'+month+':'+employeeId,()=>attendanceView(store,u,month,employeeId)));return;}
    if(path==='/api/payroll-preview'&&req.method==='GET'){if(!['MD','GM'].includes(u.role))throw new AppError('Only MD and GM can view payroll.',403);const month=validMonth(url.searchParams.get('month')||todayIST().slice(0,7)),employeeId=url.searchParams.get('employeeId')||'';const employees=store.list('employees').filter(employee=>employee.active&&employee.role!=='MD'&&(!employeeId||employee.id===employeeId));send(cached(u.id+':payroll:'+month+':'+employeeId,()=>({month,rows:employees.map(employee=>payrollPreview(store,month,employee.id)),calculated:store.list('payrolls').filter(row=>row.month===month)})));return;}
    if(path==='/api/bootstrap'&&req.method==='GET'){
     send(cached(u.id+':bootstrap',()=>{const data={},counts={};for(const k of ['customers','leads','orders','products','jobs','tasks','assignments','payments','invoices','expenses','purchases','shipments','returns','inspections','creditNotes','employees','notifications']){try{const r=page(u,k,{size:k==='employees'?500:k==='products'?250:24});data[k]=r.rows;counts[k]=r.total;}catch(e){if(e.status!==403)throw e;}}data.settings=records(store,u,'settings')[0];return {user:publicUser(u),rights:[...new Set([...(RIGHTS[u.role]||[]),...(u.grants||[])])],roles:ROLES,centres:CENTRES,data,counts,revision:store.revision,metrics:metrics(store,u),capacity:can(u,'stock')?stockCapacity(store):null,report:can(u,'reports')?report(store,u):null};}));return;
    }
    if(path==='/api/list'&&req.method==='GET'){const kind=url.searchParams.get('kind');const size=Math.max(1,Math.min(100,Number(url.searchParams.get('size'))||12));send(cached(u.id+':'+url.search,page.bind(null,u,kind,{q:(url.searchParams.get('q')||'').slice(0,150),status:url.searchParams.get('status')||'',cursor:url.searchParams.get('cursor'),size,activeOnly:url.searchParams.get('active')==='true'})));return;}
    if(path==='/api/detail'&&req.method==='GET'){
     const kind=url.searchParams.get('kind'),id=url.searchParams.get('id');const candidate=store.get(kind,id);const row=records(store,u,kind,candidate?[candidate]:[])[0];if(!row)throw new AppError('Record not found.',404);
     let events=store.db.prepare("SELECT data FROM events WHERE json_extract(data,'$.entityId')=? OR json_extract(data,'$.orderId')=? ORDER BY seq DESC LIMIT 200").all(id,id).map(r=>JSON.parse(r.data));if(!can(u,'audit'))events=events.map(({changes,...e})=>e);
     if(kind==='products')row.shortage=replenishmentShortage(store,row);send({row,events:events.slice(0,200)});return;
    }
    if(path==='/api/operations'&&req.method==='GET'){send(cached(u.id+':operations',()=>operations(store,u)));return;}
    if(path==='/api/report'&&req.method==='GET'){send(report(store,u,url.searchParams.get('from')||'',url.searchParams.get('to')||'9999-12-31'));return;}
    if(path==='/api/command'&&req.method==='POST'){const result=command(store,u,body.action,body.data||{},req.headers['idempotency-key']);send({result});return;}
    throw new AppError('Endpoint not found.',404);
   }
   if(req.method!=='GET')throw new AppError('Method not allowed.',405);
   const publicRoot=resolve(root,'public');let target=resolve(publicRoot,'.'+decodeURIComponent(path));if(!target.startsWith(publicRoot+sep)&&target!==publicRoot)throw new AppError('Path rejected.',403);
   if(path==='/'||!extname(path))target=resolve(publicRoot,'index.html');if(!existsSync(target)||!statSync(target).isFile())throw new AppError('File not found.',404);
   const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}[extname(target)]||'application/octet-stream';const stamp=statSync(target).mtimeMs;let asset=staticCache.get(target);if(!asset||asset.stamp!==stamp){const body=readFileSync(target);asset={stamp,body,etag:'"'+digest(body)+'"'};staticCache.set(target,asset);}res.setHeader('Cache-Control','private, max-age=0, must-revalidate');res.setHeader('ETag',asset.etag);if(req.headers['if-none-match']===asset.etag){res.writeHead(304);res.end();return;}res.writeHead(200,{'Content-Type':mime});res.end(asset.body);
  }catch(e){if(e.status)send({error:e.message},e.status);else{console.error(e);send({error:'An unexpected error occurred. Your changes were not saved.'},500);}}
 });return {server,store};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.env.NODE_ENV==='production')throw new Error('This local review server is not a production deployment adapter.');
 const {server}=createApp();const port=Number(process.env.PORT||3000);server.listen(port,'127.0.0.1',()=>console.log('Hanicraft local review: http://localhost:'+port));
}

