import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('echodeck', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  getDesktopSources: () => ipcRenderer.invoke('desktop:sources'),
  captureScreenshot: () => ipcRenderer.invoke('desktop:capture'),
  diagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback:(status:unknown)=>void) => { const listener=(_event:Electron.IpcRendererEvent,status:unknown)=>callback(status);ipcRenderer.on('update:status',listener);return()=>ipcRenderer.removeListener('update:status',listener) }
  },
  mumble: {
    connect: (connection:{host:string;port:number;username:string;password:string;channelName:string}) => ipcRenderer.invoke('mumble:connect',connection),
    state: () => ipcRenderer.invoke('mumble:state'),
    onState: (callback:(status:unknown)=>void) => { const listener=(_event:Electron.IpcRendererEvent,status:unknown)=>callback(status);ipcRenderer.on('mumble:state',listener);return()=>ipcRenderer.removeListener('mumble:state',listener) },
    command: (command:string) => ipcRenderer.invoke('mumble:command',command),
    disconnect: () => ipcRenderer.invoke('mumble:disconnect'),
    level: () => ipcRenderer.invoke('mumble:level'),
    volumes: () => ipcRenderer.invoke('mumble:volumes'),
    setVolume: (kind:'input'|'output',value:number) => ipcRenderer.invoke('mumble:set-volume',kind,value),
    users: () => ipcRenderer.invoke('mumble:users'),
    setUserVolume: (username:string,value:number) => ipcRenderer.invoke('mumble:set-user-volume',username,value),
    devices: () => ipcRenderer.invoke('mumble:devices'),
    setInput: (index:number) => ipcRenderer.invoke('mumble:set-input',index),
    setOutput: (index:number) => ipcRenderer.invoke('mumble:set-output',index)
  }
});
