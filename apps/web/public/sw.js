const CACHE='poio-web-v2';
const BASE='/poio/web/';
const SHELL=[BASE,`${BASE}index.html`,`${BASE}manifest.webmanifest`,`${BASE}icon.png`];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&['script','style','image','font'].includes(event.request.destination)){
      const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    }
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached??caches.match(`${BASE}index.html`))));
});
