import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createPinia } from 'pinia'
import { AxiosError } from 'axios'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'
const user = id => ({id, email:id+'@example.test',status:'ACTIVE',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'})
const body = id => ({user:user(id),accessToken:'access-'+id,csrfToken:'csrf-'+id,accessTokenExpiresAt:'2026-11-09T00:15:00Z'})
const reply = (config,data,status=200) => ({config,data,status,statusText:'test',headers:{}})
const unauthorized = config => new AxiosError('401',AxiosError.ERR_BAD_RESPONSE,config,undefined,reply(config,{},401))
const tick = () => new Promise(resolve=>setImmediate(resolve))
const deferred = () => {let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
let store
installAuthInterceptors({getAccessToken:()=>store.accessToken,getSessionGeneration:()=>store.getSessionGeneration?.() ?? 0,refreshSession:()=>store.refreshSession(),clearSession:()=>store.clearSession()})
let adapter
Object.defineProperty(api.defaults, 'adapter', {configurable:true,get:()=>adapter,set:handler=>{adapter=handler?config=>config.url==='/auth/context'?Promise.resolve(reply(config,{contextId:'a'.repeat(64),csrfToken:'current'})):handler(config):undefined}})
function setup(){store=useAuthStore(createPinia());store.accessToken='access-A';store.csrfToken='csrf-A';store.user=user('A');store.status='authenticated';return store}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('operation pending')),800)})])}finally{clearTimeout(timer)}}
for(const next of ['A','B']) test(`old 401 cannot replay after a new login (${next})`,async()=>{
 setup();const held=deferred();let writes=0,refreshes=0
 api.defaults.adapter=async config=>{
  if(config.url==='/athletes/me'){writes++;await held.promise;throw unauthorized(config)}
  if(config.url==='/auth/login')return reply(config,body(next))
  if(config.url==='/auth/me')return reply(config,user(next))
  if(config.url==='/auth/refresh'){refreshes++;return reply(config,body(next))}
  throw Error('unexpected '+config.url)
 }
 const old=Promise.allSettled([api.patch('/athletes/me',{preferredUnit:'LB'}),api.get('/athletes/me')]);await tick()
 store.clearSession();await store.login({email:next+'@example.test',password:'valid-password'})
 held.resolve();const result=await bounded(old)
 assert.equal(writes,2);assert.equal(refreshes,0);assert.ok(result.every(r=>r.status==='rejected'));assert.equal(store.user.id,next);assert.equal(store.status,'authenticated')
})
test('late successful responses cannot reach the new account consumers',async()=>{
 setup();const held=deferred();api.defaults.adapter=async config=>{if(config.url==='/athletes/me'){await held.promise;return reply(config,{private:'A'})}if(config.url==='/auth/login')return reply(config,body('B'));return reply(config,user('B'))}
 const old=api.get('/athletes/me');const result=assert.rejects(old);await tick();await store.login({email:'B@example.test',password:'valid-password'});held.resolve();await bounded(result);assert.equal(store.user.id,'B')
})
for(const failure of [false,true]) test(`old individual logout cannot clear a new login (network failure ${failure})`,async()=>{
 setup();const held=deferred();api.defaults.adapter=async config=>{if(config.url==='/auth/logout'){await held.promise;if(failure)throw new AxiosError('network',AxiosError.ERR_NETWORK,config);return reply(config,undefined,204)}if(config.url==='/auth/login')return reply(config,body('B'));return reply(config,user('B'))}
 const closing=store.logout();const outcome=Promise.allSettled([closing]);await tick();await store.login({email:'B@example.test',password:'valid-password'});held.resolve();await bounded(outcome);assert.equal(store.status,'authenticated');assert.equal(store.user.id,'B')
})
after(()=>{api.defaults.adapter=undefined})

test('replacing the interceptor provider cannot reuse an equal numeric generation',async()=>{
 const held=deferred();let attempts=0
 installAuthInterceptors({getAccessToken:()=> 'A',getSessionGeneration:()=>0,refreshSession:async()=>{},clearSession:()=>{}})
 api.defaults.adapter=async config=>{attempts++;await held.promise;throw unauthorized(config)}
 const old=Promise.allSettled([api.patch('/athletes/me',{preferredUnit:'LB'})]);await tick()
 installAuthInterceptors({getAccessToken:()=> 'B',getSessionGeneration:()=>0,refreshSession:async()=>{},clearSession:()=>{}})
 held.resolve();await bounded(old);assert.equal(attempts,1)
})

test('dispatch context is bound before a synchronous account change',async()=>{
 setup();installAuthInterceptors({getAccessToken:()=>store.accessToken,getSessionGeneration:()=>store.getSessionGeneration(),refreshSession:()=>store.refreshSession(),clearSession:()=>store.clearSession()})
 const sent=[];api.defaults.adapter=async config=>{if(config.url==='/athletes/me'){sent.push(config.headers.get('Authorization'));throw unauthorized(config)}if(config.url==='/auth/login')return reply(config,body('B'));if(config.url==='/auth/me')return reply(config,user('B'));throw Error('unexpected')}
 const old=Promise.allSettled([api.patch('/athletes/me',{preferredUnit:'LB'})]);await store.login({email:'B@example.test',password:'valid-password'});await bounded(old);assert.deepEqual(sent,['Bearer access-A']);assert.equal(store.user.id,'B')
})
test('login during refresh does not apply or replay the old refresh result',async()=>{
 setup();const held=deferred();let writes=0
 api.defaults.adapter=async config=>{if(config.url==='/athletes/me'){writes++;throw unauthorized(config)}if(config.url==='/auth/refresh'){await held.promise;return reply(config,body('A'))}if(config.url==='/auth/login')return reply(config,body('B'));if(config.url==='/auth/me')return reply(config,user('B'));throw Error('unexpected')}
 const old=Promise.allSettled([api.patch('/athletes/me',{preferredUnit:'LB'})]);await tick();await store.login({email:'B@example.test',password:'valid-password'});held.resolve();await bounded(old);assert.equal(writes,1);assert.equal(store.status,'authenticated');assert.equal(store.user.id,'B')
})
test('an old network error cannot clear the newer login',async()=>{
 setup();const held=deferred();api.defaults.adapter=async config=>{if(config.url==='/athletes/me'){await held.promise;throw new AxiosError('network',AxiosError.ERR_NETWORK,config)}if(config.url==='/auth/login')return reply(config,body('B'));return reply(config,user('B'))}
 const old=Promise.allSettled([api.get('/athletes/me')]);await tick();await store.login({email:'B@example.test',password:'valid-password'});held.resolve();await bounded(old);assert.equal(store.user.id,'B');assert.equal(store.status,'authenticated')
})
