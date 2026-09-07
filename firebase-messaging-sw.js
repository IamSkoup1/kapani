/* Kapani Push Service Worker — FCM / Web Push */
const KAPANI_SW_VERSION='2026-09-07-push-2';

try{
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
  importScripts("./config.js");
  if(!self.KAPANI_CONFIG?.firebase) throw new Error("Kapani config.js не загрузил Firebase-конфигурацию");
  firebase.initializeApp(self.KAPANI_CONFIG.firebase);
  const messaging=firebase.messaging();

  // Backend sends DATA-ONLY FCM messages. This is the single notification
  // rendering point, preventing duplicate banners.
  messaging.onBackgroundMessage(async(payload)=>{
    try{
      const d=payload?.data||{};
      const title=String(d.title||'Капани');
      const body=String(d.body||'');
      const url=String(d.url||'./index.html');
      const notificationId=String(d.notificationId||payload?.messageId||'');
      const tag=notificationId?`kapani-push-${notificationId}`:'kapani-push';
      try{
        const existing=await self.registration.getNotifications({tag});
        if(existing?.length)return;
      }catch(_){}
      await self.registration.showNotification(title,{
        body,
        icon:String(d.icon||'./image.png'),
        badge:String(d.badge||'./image.png'),
        tag,
        renotify:false,
        data:{url,notificationId,category:String(d.category||'system')}
      });
    }catch(e){console.error('[Kapani SW] push:',e);}
  });
}catch(e){console.error('[Kapani SW] init:',e);}

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',(event)=>event.waitUntil((async()=>{
  await self.clients.claim();
  try{await self.registration.update();}catch(_){}
})()));

self.addEventListener('notificationclick',(event)=>{
  event.notification.close();
  let targetUrl=String(event.notification?.data?.url||'./index.html');
  try{targetUrl=new URL(targetUrl,self.location.origin).href;}
  catch(_){targetUrl=new URL('./index.html',self.location.origin).href;}

  event.waitUntil((async()=>{
    const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clientsList){
      try{
        const target=new URL(targetUrl);
        const current=new URL(client.url);
        if(current.origin===target.origin){
          await client.focus();
          if('navigate' in client) await client.navigate(targetUrl);
          return;
        }
      }catch(_){}
    }
    if(self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
