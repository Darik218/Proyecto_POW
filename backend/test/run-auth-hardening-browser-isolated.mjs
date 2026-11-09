import {mkdtemp,mkdir,realpath,rm,open} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
const run=promisify(execFile),bin=process.env.PULSO_POSTGRES_BIN??'/usr/lib/postgresql/18/bin'
const root=await mkdtemp(join(tmpdir(),'pulso-auth-hardening-')),data=join(root,'data'),socket=join(root,'socket')
const database='pulso_auth_hardening_test',children=[],logs=[]
let started=false
async function port(){const server=createServer();await new Promise((a,b)=>{server.once('error',b);server.listen(0,'127.0.0.1',a)});const p=server.address().port;await new Promise(a=>server.close(a));return p}
async function ready(url){for(let n=0;n<160;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(500)});if(r.ok)return}catch{}await new Promise(a=>setTimeout(a,200))}throw Error('Runtime unavailable: '+url)}
async function launch(cmd,args,env,name,cwd=process.cwd()){const log=await open(join(root,name+'.log'),'a',0o600);logs.push(log);const child=spawn(cmd,args,{env,cwd,stdio:['ignore',log.fd,log.fd]});children.push(child);return child}
try{
 await mkdir(socket)
 const dbPort=await port(),apiPort=await port(),vitePort=await port(),driverPort=await port(),peerDriverPort=await port()
 await run(join(bin,'initdb'),['-D',data,'--auth-local=trust','--auth-host=trust','--username=pulso_test','--no-locale','--encoding=UTF8'])
 await run(join(bin,'pg_ctl'),['-D',data,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${dbPort} -k ${socket}`,'-w','start']);started=true
 const admin=new pg.Client({host:'127.0.0.1',port:dbPort,user:'pulso_test',database:'postgres'});await admin.connect()
 try{const {rows}=await admin.query("SELECT current_setting('data_directory') AS directory");if(await realpath(rows[0].directory)!==await realpath(data))throw Error('Wrong cluster');await admin.query('CREATE DATABASE pulso_auth_hardening_test')}finally{await admin.end()}
 const url=`postgresql://pulso_test@127.0.0.1:${dbPort}/${database}`
 const target=new URL(url);if(target.hostname!=='127.0.0.1'||target.pathname!=='/'+database||target.port!==String(dbPort)||database==='proyecto_pow_dev')throw Error('Unsafe target')
 const check=new pg.Client({connectionString:url});await check.connect()
 try{const {rows}=await check.query("SELECT current_database() AS database,current_setting('data_directory') AS directory");if(rows[0].database!==database||await realpath(rows[0].directory)!==await realpath(data))throw Error('Wrong database')}finally{await check.end()}
 console.log(`Verified private cluster ${root}; database ${database}; localhost port ${dbPort}. No development writes or seeds.`)
 const origin=`http://127.0.0.1:${vitePort}`,secret=randomBytes(32).toString('hex')
 const env={...process.env,DATABASE_URL:url,NODE_ENV:'test',AUTH_ACCESS_TOKEN_SECRET:secret,AUTH_REFRESH_TOKEN_PEPPER:randomBytes(32).toString('hex'),CORS_ORIGINS:origin,AUTH_COOKIE_SECURE:'false',PORT:String(apiPort)}
 const prisma=resolve('node_modules/prisma/build/index.js')
 for(const args of [['migrate','deploy'],['migrate','status'],['migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code']])await run(process.execPath,[prisma,...args],{env,timeout:60000,maxBuffer:2**21})
 await run('npm',['run','build'],{env,timeout:60000,maxBuffer:2**21})
 await launch(process.execPath,['dist/main.js'],env,'api');await ready(`http://127.0.0.1:${apiPort}/api/v1`)
 await launch(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(vitePort),'--strictPort'],{...env,VITE_DEV_API_PROXY_TARGET:`http://127.0.0.1:${apiPort}`},'vite',resolve('../frontend'));await ready(origin)
 await launch('/snap/firefox/current/usr/lib/firefox/geckodriver',['--host','127.0.0.1','--port',String(driverPort)],process.env,'webdriver');await ready(`http://127.0.0.1:${driverPort}/status`)
 await launch('/snap/firefox/current/usr/lib/firefox/geckodriver',['--host','127.0.0.1','--port',String(peerDriverPort)],process.env,'webdriver-peer');await ready(`http://127.0.0.1:${peerDriverPort}/status`)
 const output=await new Promise((accept,reject)=>{const child=execFile(process.execPath,['tests/auth-hardening.browser.mjs'],{cwd:resolve('../frontend'),timeout:240000,maxBuffer:2**22},(error,stdout,stderr)=>{void stdout;void stderr;if(error)reject(Error('Firefox verification failed'));else accept()});child.stdout.on('data',chunk=>process.stdout.write(chunk));child.stderr.on('data',chunk=>process.stderr.write(chunk));child.stdin.end(JSON.stringify({origin,driver:`http://127.0.0.1:${driverPort}`,driverPeer:`http://127.0.0.1:${peerDriverPort}`,databaseUrl:url,dataDirectory:data,secret}))});void output
}catch(error){console.error(error.message);process.exitCode=1}
finally{
 for(const child of children.reverse()){if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(a=>child.once('exit',a)),new Promise(a=>setTimeout(a,3000))]);if(child.exitCode===null)child.kill('SIGKILL')}}
 for(const log of logs)await log.close()
 if(started){try{await run(join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop']);started=false}catch{console.error('Temporary cluster cleanup pending: '+root);process.exitCode=1}}
 if(!started)await rm(root,{recursive:true,force:true})
 console.log(started?'Temporary cleanup incomplete.':'Private runtime stopped and removed. Development untouched.')
}
