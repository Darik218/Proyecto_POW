import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createPinia } from 'pinia'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'
import { AxiosError } from 'axios'
const account={id:'A',email:'a@example.test',status:'ACTIVE',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'}
const auth=(token='access-A')=>({user:account,accessToken:token,csrfToken:'rotated',accessTokenExpiresAt:'2026-01-01T00:15:00Z'})
const reply=(config,data)=>({config,data,status:200,statusText:'OK',headers:{}})
let store
installAuthInterceptors({getAccessToken:()=>store?.accessToken??null,getSessionGeneration:()=>store?.getSessionGeneration()??0,refreshSession:()=>store.refreshSession(),clearSession:()=>store.clearSession()})
afterEach(()=>{delete globalThis.window;delete globalThis.document;api.defaults.adapter=undefined})
test('new independent tab bootstraps invisible CSRF without another tab or storage',async()=>{
 globalThis.document={cookie:''};store=useAuthStore(createPinia());let contexts=0
 api.defaults.adapter=async config=>{if(config.url==='/auth/context'){contexts++;return reply(config,{contextId:'a'.repeat(64),csrfToken:'current-cookie'})}if(config.url==='/auth/refresh'){assert.equal(config.headers.get('X-CSRF-Token'),'current-cookie');return reply(config,auth())}if(config.url==='/auth/me')return reply(config,account);throw Error('unexpected '+config.url)}
 await store.initialize();assert.equal(store.status,'authenticated');assert.equal(contexts,1)
})
test('every rotation reads current context and CSRF, ignoring stale tab memory',async()=>{
 store=useAuthStore(createPinia());store.csrfToken='obsolete';let csrf='first',refreshes=0
 api.defaults.adapter=async config=>{if(config.url==='/auth/context')return reply(config,{contextId:'a'.repeat(64),csrfToken:csrf});if(config.url==='/auth/refresh'){assert.equal(config.headers.get('X-CSRF-Token'),csrf);refreshes++;return reply(config,auth('access-'+refreshes))}if(config.url==='/auth/me')return reply(config,account);throw Error('unexpected')}
 await store.refreshSession();csrf='rotated-in-other-tab';await store.refreshSession();assert.equal(refreshes,2)
})
test('missed intertab notification cannot switch the known cookie session, even same user',async()=>{
 store=useAuthStore(createPinia());let context='a'.repeat(64),refreshes=0
 api.defaults.adapter=async config=>{if(config.url==='/auth/context')return reply(config,{contextId:context,csrfToken:'current'});if(config.url==='/auth/refresh'){refreshes++;return reply(config,auth())}if(config.url==='/auth/me')return reply(config,account);throw Error('unexpected')}
 await store.refreshSession();context='b'.repeat(64);await assert.rejects(store.refreshSession());assert.equal(refreshes,1);assert.equal(store.status,'anonymous')
})
test('changed account in refresh response is rejected before acceptance',async()=>{
 store=useAuthStore(createPinia());store.accessToken='old';store.csrfToken='old';store.user=account;store.status='authenticated'
 api.defaults.adapter=async config=>{if(config.url==='/auth/context')return reply(config,{contextId:'a'.repeat(64),csrfToken:'current'});if(config.url==='/auth/refresh')return reply(config,{...auth(),user:{...account,id:'B'}});return reply(config,{...account,id:'B'})}
 await assert.rejects(store.refreshSession());assert.equal(store.user,null)
})
test('revoked bootstrap cannot invoke refresh or leak previous credentials',async()=>{
 store=useAuthStore(createPinia());const calls=[];api.defaults.adapter=async config=>{calls.push(config.url);throw new AxiosError('401',undefined,config,undefined,{config,status:401,data:{},headers:{},statusText:'Unauthorized'})}
 await store.initialize();assert.equal(store.status,'anonymous');assert.deepEqual(calls,['/auth/context'])
})

test('browser cookie lock serializes operations and notifications contain no credentials',async(t)=>{
 const {createAuthCoordination}=await import('../src/services/auth-coordination.ts')
 const saved=Object.getOwnPropertyDescriptor(globalThis,'navigator');const original=globalThis.BroadcastChannel
 t.after(()=>{if(saved)Object.defineProperty(globalThis,'navigator',saved);else delete globalThis.navigator;globalThis.BroadcastChannel=original})
 globalThis.window={};let tail=Promise.resolve(),active=0,peak=0;const messages=[],channels=[]
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request(_key,_options,callback){const next=tail.then(callback);tail=next.catch(()=>{});return next}}}})
 globalThis.BroadcastChannel=class{constructor(){channels.push(this)}postMessage(value){messages.push(value);for(const other of channels)if(other!==this)other.onmessage?.({data:value})}close(){}}
 let boundaries=0,rotations=0
 const a=createAuthCoordination(()=>{},()=>{}),b=createAuthCoordination(()=>boundaries++,()=>rotations++)
 await Promise.all([a.run(async()=>{peak=Math.max(peak,++active);await new Promise(r=>setImmediate(r));active--}),b.run(async()=>{peak=Math.max(peak,++active);active--})])
 assert.equal(peak,1);a.rotation();a.boundary();assert.equal(boundaries,1);assert.equal(rotations,1);assert.deepEqual(messages,['rotation','boundary']);a.close();b.close()
})
test('browser without Web Locks fails closed instead of racing refresh cookies',async(t)=>{
 const {createAuthCoordination}=await import('../src/services/auth-coordination.ts')
 const saved=Object.getOwnPropertyDescriptor(globalThis,'navigator');t.after(()=>{if(saved)Object.defineProperty(globalThis,'navigator',saved);else delete globalThis.navigator})
 globalThis.window={};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}})
 const coordinator=createAuthCoordination(()=>{},()=>{});let invoked=false
 try{await assert.rejects(coordinator.run(async()=>{invoked=true}),/coordinar/);assert.equal(invoked,false)}finally{coordinator.close()}
})
test('malformed session context is visible failure and cannot rotate',async()=>{
 store=useAuthStore(createPinia());let refreshes=0
 api.defaults.adapter=async config=>{if(config.url==='/auth/context')return reply(config,{csrfToken:'value'});refreshes++;throw Error('unexpected')}
 await assert.rejects(store.refreshSession());assert.equal(refreshes,0);assert.equal(store.status,'anonymous')
})
