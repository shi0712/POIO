import { io, type Socket } from 'socket.io-client';

export type User = { id: string; username: string; avatarUrl?:string };
export type Channel = { id: string; spaceId?: string; name: string; kind: 'text'|'voice'; position: number };
export type Space = { id: string; name: string; ownerId: string; channels: Channel[] };
export type ChatMessage = { id:string;channelId:string;body:string;createdAt:number;userId:string;username:string;avatarUrl?:string;attachmentUrl?:string;attachmentName?:string;attachmentSize?:number;attachmentMime?:string };
type Reply<T> = {ok:true;value:T}|{ok:false;error:string};

export const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'https://115.159.222.29/echodeck';
const endpoint=new URL(serverUrl); const socketPath=`${endpoint.pathname.replace(/\/$/,'')}/socket.io`||'/socket.io';
export const socket: Socket = io(endpoint.origin, { path:socketPath,autoConnect: true, transports: ['websocket','polling'], reconnectionDelayMax: 5000 });
const sessionKey='echodeck.session';
let connectedOnce=false;
let finishRestore:(()=>void)|undefined;
let authReady=Promise.resolve();

function beginRestore(){
  if(finishRestore)return;
  authReady=new Promise<void>((resolve)=>{finishRestore=resolve});
}
function endRestore(){finishRestore?.();finishRestore=undefined;}

socket.on('disconnect',()=>{window.dispatchEvent(new Event('poio:socket-disconnected'));if(localStorage.getItem(sessionKey))beginRestore()});
socket.on('connect',()=>{
  if(!connectedOnce){connectedOnce=true;return;}
  const token=localStorage.getItem(sessionKey);
  if(!token){endRestore();return;}
  beginRestore();
  socket.emit('auth:resume',{token},(reply:Reply<AuthPayload>)=>{
    if(!reply?.ok){
      localStorage.removeItem(sessionKey);
      window.dispatchEvent(new Event('poio:session-expired'));
    }else window.dispatchEvent(new Event('poio:session-restored'));
    endRestore();
  });
});

export async function request<T>(event: string, payload: unknown = {}) {
  if(!event.startsWith('auth:'))await Promise.race([
    authReady,
    new Promise<void>((_resolve,reject)=>window.setTimeout(()=>reject(new Error('连接恢复超时，请检查网络后重试')),15_000))
  ]);
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('服务器响应超时')), 15_000);
    socket.emit(event, payload, (reply: Reply<T>) => {
      clearTimeout(timeout);
      if (reply?.ok) resolve(reply.value); else reject(new Error(reply?.error || '请求失败'));
    });
  });
}

export async function uploadFile(file:File,token:string){const form=new FormData();form.append('file',file);const response=await fetch(`${serverUrl}/api/uploads`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});const result=await response.json();if(!response.ok)throw new Error(result.error||'文件上传失败');return result as {url:string;name:string;size:number;mime:string}}

export type AuthPayload = {token:string;user:User;bootstrap:Space[]};
