import { spawn } from "node:child_process";
import path from "node:path";
import { io } from "socket.io-client";

const origin = process.env.ECHODECK_SMOKE_URL ?? "https://115.159.222.29";
const socket = io(origin, {
  path: "/echodeck/socket.io",
  transports: ["websocket"],
  reconnection: false,
});
const request = (event, payload = {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${event} timeout`)),
      15000,
    );
    socket.emit(event, payload, (reply) => {
      clearTimeout(timer);
      reply?.ok
        ? resolve(reply.value)
        : reject(new Error(reply?.error ?? `${event} failed`));
    });
  });
await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});
const suffix = Date.now().toString(36);
const username = `chatux_${suffix}`;
const password = `Test-${suffix}-secure`;
const markdownSample = "**粗体**\n\n- [x] 任务\n\n```js\nconst answer = 42;\n```";
const expandedSendSample = "展开后发送第一行\n展开后发送第二行";
const multilineSample = "第一行\n第二行\n第三行";
const auth = await request("auth:register", { username, password });
const unreadChannel = auth.bootstrap[0].channels.find(
  (channel) => channel.kind === "text",
);
const desktop = path.resolve("apps/desktop");
const packagedPath = process.env.ECHODECK_DESKTOP_EXE
  ? path.resolve(process.env.ECHODECK_DESKTOP_EXE)
  : "";
const electronPath =
  packagedPath || path.resolve("node_modules/electron/dist/electron.exe");
const port = 9338;
const child = spawn(
  electronPath,
  [`--remote-debugging-port=${port}`, ...(packagedPath ? [] : [desktop])],
  {
    cwd: packagedPath ? path.dirname(packagedPath) : desktop,
    windowsHide: true,
    stdio: "ignore",
  },
);
let ws;
let sequence = 0;
const evaluate = (expression, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    expression = expression
      .replace(`'${markdownSample}'`, JSON.stringify(markdownSample))
      .replace(`'${expandedSendSample}'`, JSON.stringify(expandedSendSample))
      .replace(`'${multilineSample}'`, JSON.stringify(multilineSample));
    const id = ++sequence;
    const timer = setTimeout(
      () => reject(new Error("CDP evaluate timeout")),
      timeoutMs,
    );
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", listener);
      if (message.result?.exceptionDetails)
        reject(
          new Error(
            message.result.exceptionDetails.exception?.description ??
              message.result.exceptionDetails.text,
          ),
        );
      else resolve(message.result.result.value);
    };
    ws.addEventListener("message", listener);
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
try {
  const deadline = Date.now() + 20000;
  let target;
  while (Date.now() < deadline && !target) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      target = (
        await fetch(`http://127.0.0.1:${port}/json`).then((response) =>
          response.json(),
        )
      ).find((item) => item.type === "page" && item.url.includes("index.html"));
    } catch {}
  }
  if (!target) throw new Error("Electron renderer target not found");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  await evaluate(`localStorage.clear();'cleared'`);
  await evaluate(`location.reload();true`).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 700));
  const result = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));const setValue=(input,value)=>{const prototype=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))};for(let i=0;i<60&&!document.querySelector('.auth-card input');i++)await sleep(150);const inputs=[...document.querySelectorAll('.auth-card input')];setValue(inputs[0],${JSON.stringify(username)});setValue(inputs[1],${JSON.stringify(password)});document.querySelector('.auth-card .primary').click();for(let i=0;i<100&&!document.querySelector('.group-title button')&&!document.querySelector('.toast');i++)await sleep(150);if(!document.querySelector('.group-title button'))throw new Error('login failed: '+(document.querySelector('.toast')?.textContent??''));const screenshotAction=Boolean(document.querySelector('button[title="区域截图"]'));document.querySelector('button[title="展开编辑器"]')?.click();await sleep(100);const expanded=Boolean(document.querySelector('.composer.expanded .composer-toolbar'));const markdownInput=document.querySelector('.composer textarea');setValue(markdownInput,'**粗体**\n\n- [x] 任务\n\n\`\`\`js\nconst answer = 42;\n\`\`\`');document.querySelector('button[title="预览 Markdown"]')?.click();await sleep(150);const markdownPreview={bold:Boolean(document.querySelector('.composer-markdown-preview strong')),task:Boolean(document.querySelector('.composer-markdown-preview input[type=checkbox]')),code:Boolean(document.querySelector('.composer-markdown-preview .markdown-code')),copy:Boolean(document.querySelector('.composer-markdown-preview .markdown-code button'))};document.querySelector('button[title="返回编辑"]')?.click();await sleep(60);const sendInput=document.querySelector('.composer textarea');setValue(sendInput,'展开后发送第一行\n展开后发送第二行');document.querySelector('.composer-send')?.click();for(let i=0;i<60&&sendInput.value;i++)await sleep(100);document.querySelector('button[title="收起编辑器"]')?.click();await sleep(100);const collapsedComposer=document.querySelector('.composer'),collapsedInput=document.querySelector('.composer textarea');const collapsedRect=collapsedComposer.getBoundingClientRect(),collapsedInputRect=collapsedInput.getBoundingClientRect();const expandedSend={sent:sendInput.value==='',collapsed:!collapsedComposer.classList.contains('expanded'),placeholderInside:collapsedInputRect.top>=collapsedRect.top-1&&collapsedInputRect.bottom<=collapsedRect.bottom+1,composerHeight:collapsedRect.height,inputHeight:collapsedInputRect.height};document.querySelector('.group-title button').click();for(let i=0;i<30&&!document.querySelector('.channel-modal input');i++)await sleep(100);const channelInput=document.querySelector('.channel-modal input');if(!channelInput)throw new Error('channel modal missing');setValue(channelInput,'拖拽测试');document.querySelector('.channel-modal .primary').click();for(let i=0;i<60&&![...document.querySelectorAll('.channel')].some(node=>node.textContent.includes('拖拽测试'));i++)await sleep(100);const channelCreated=[...document.querySelectorAll('.channel')].some(node=>node.textContent.includes('拖拽测试'));const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';const makeFile=name=>new File([Uint8Array.from(atob(png),character=>character.charCodeAt(0))],name,{type:'image/png'});const composer=document.querySelector('.composer');const dragData=new DataTransfer();dragData.items.add(makeFile('drag.png'));composer.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:dragData}));await sleep(100);const dragOverlay=Boolean(document.querySelector('.composer-drop'));composer.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dragData}));for(let i=0;i<150&&document.querySelectorAll('.image-attachment').length<1&&!document.querySelector('.toast');i++)await sleep(100);const pasteData=new DataTransfer();pasteData.items.add(makeFile('paste.png'));document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:pasteData}));for(let i=0;i<150&&document.querySelectorAll('.image-attachment').length<2&&!document.querySelector('.toast');i++)await sleep(100);const images=document.querySelectorAll('.image-attachment');images[0]?.click();for(let i=0;i<30&&!document.querySelector('.image-preview');i++)await sleep(100);const preview=Boolean(document.querySelector('.image-preview'));const list=document.querySelector('.message-list');const autoScrolled=list.scrollHeight-list.scrollTop-list.clientHeight<8;return {channelCreated,screenshotAction,expanded,expandedSend,markdownPreview,dragOverlay,attachmentCount:images.length,preview,autoScrolled,onlineSections:[...document.querySelectorAll('.member-title')].map(node=>node.textContent),toast:document.querySelector('.toast')?.textContent??''}})()`,
    60000,
  );
  await evaluate(
    `document.querySelector('.image-preview header button')?.click()`,
  );
  const multilineComposer = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));const input=document.querySelector('.composer textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'第一行\n第二行\n第三行');input.dispatchEvent(new Event('input',{bubbles:true}));await sleep(150);const composer=input.closest('.composer');const inputRect=input.getBoundingClientRect(),composerRect=composer.getBoundingClientRect();const result={composerHeight:composerRect.height,inputHeight:inputRect.height,contained:inputRect.top>=composerRect.top-1&&inputRect.bottom<=composerRect.bottom+1,scrollable:input.scrollHeight>input.clientHeight};setter.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));return result})()`,
  );
  const longComposer = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));const input=document.querySelector('.composer textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'long line\\n'.repeat(200));input.dispatchEvent(new Event('input',{bubbles:true}));await sleep(150);const style=getComputedStyle(input);const before=input.scrollTop;input.scrollTop=input.scrollHeight;const result={height:input.getBoundingClientRect().height,scrollHeight:input.scrollHeight,clientHeight:input.clientHeight,overflowY:style.overflowY,scrollable:input.scrollTop>before,maxLength:input.maxLength};setter.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));return result})()`,
  );
  const refreshed = await request("bootstrap");
  const activeTextChannel = refreshed[0].channels.find(
    (channel) => channel.kind === "text" && channel.id !== unreadChannel.id,
  );
  if (!activeTextChannel) throw new Error("created text channel missing");
  await Promise.all(
    Array.from({ length: 120 }, (_, index) =>
      request("chat:send", {
        channelId: activeTextChannel.id,
        body: `history-${index}-${suffix}`,
      }),
    ),
  );
  const historyOverflow = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<100&&document.querySelectorAll('.message').length<120;i++)await sleep(100);await sleep(500);const list=document.querySelector('.message-list');const initialBottom=list.scrollHeight-list.scrollTop-list.clientHeight<12;list.scrollTop=0;list.dispatchEvent(new Event('scroll',{bubbles:true}));await sleep(120);return {messageCount:document.querySelectorAll('.message').length,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,overflowY:getComputedStyle(list).overflowY,initialBottom,top:list.scrollTop,jumpVisible:Boolean(document.querySelector('.message-jump-latest'))}})()`,
  );
  await request("chat:send", {
    channelId: activeTextChannel.id,
    body: `history-newest-${suffix}`,
  });
  const historyBrowse = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<60&&![...document.querySelectorAll('.message p')].some(node=>node.textContent===${JSON.stringify(`history-newest-${suffix}`)});i++)await sleep(100);const list=document.querySelector('.message-list');const stayedAtTop=list.scrollTop<20;const jump=document.querySelector('.message-jump-latest');jump?.click();for(let i=0;i<40&&list.scrollHeight-list.scrollTop-list.clientHeight>=12;i++)await sleep(50);return {stayedAtTop,jumpVisible:Boolean(jump),returnedToLatest:list.scrollHeight-list.scrollTop-list.clientHeight<12}})()`,
  );
  await request("chat:send", {
    channelId: unreadChannel.id,
    body: `unread-${suffix}`,
  });
  const unread = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<50&&!document.querySelector('.unread-pill');i++)await sleep(100);const badge=document.querySelector('.unread-pill')?.textContent??'';const spaceDot=Boolean(document.querySelector('.space-unread'));const target=[...document.querySelectorAll('.channel')].find(node=>node.textContent.includes(${JSON.stringify(unreadChannel.name)}));target?.click();for(let i=0;i<30&&document.querySelector('.unread-pill');i++)await sleep(100);return {badge,spaceDot,cleared:!document.querySelector('.unread-pill')}})()`,
  );
  const avatarForm = new FormData();
  avatarForm.append("file", new File([Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64")], "动态头像.gif", { type: "image/gif" }));
  const avatarResponse = await fetch(`${origin}/echodeck/api/uploads`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}` }, body: avatarForm });
  const avatarUpload = await avatarResponse.json();
  const updatedUser = await request("user:avatar", { url: avatarUpload.url });
  const avatarUi = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<50&&!document.querySelector('.account-trigger .avatar img');i++)await sleep(100);const image=document.querySelector('.account-trigger .avatar img');return {custom:Boolean(image),src:image?.getAttribute('src')??''}})()`,
  );
  const accountPopover = await evaluate(
    `(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));document.querySelector('.account-trigger')?.click();for(let i=0;i<20&&!document.querySelector('.account-popover');i++)await sleep(50);const popover=document.querySelector('.account-popover');const avatarButton=document.querySelector('.change-avatar-button');const update=document.querySelector('.account-update');const logout=document.querySelector('.logout-button');if(!popover||!avatarButton||!update||!logout)return {visible:false};const popoverRect=popover.getBoundingClientRect(),avatarRect=avatarButton.getBoundingClientRect(),updateRect=update.getBoundingClientRect(),logoutRect=logout.getBoundingClientRect();const result={visible:true,width:Math.round(popoverRect.width),buttonWidth:Math.round(avatarRect.width),singleLine:avatarButton.scrollHeight<=avatarButton.clientHeight&&getComputedStyle(avatarButton).whiteSpace==='nowrap',noOverlap:avatarRect.bottom<=updateRect.top&&updateRect.bottom<=logoutRect.top};document.querySelector('.account-trigger')?.click();return result})()`,
  );
  const screenshotIpc = await evaluate(
    `window.echodeck.captureScreenshot().then(value=>({width:value.width,height:value.height,png:value.dataUrl.startsWith('data:image/png;base64,'),displayName:value.displayName}))`,
    30000,
  );
  if (
    !screenshotIpc.png ||
    screenshotIpc.width < 640 ||
    screenshotIpc.height < 480 ||
    !avatarResponse.ok ||
    !updatedUser.avatarUrl?.endsWith(".gif") ||
    !avatarUi.custom ||
    !avatarUi.src.endsWith(updatedUser.avatarUrl) ||
    !accountPopover.visible ||
    accountPopover.width < 230 ||
    accountPopover.buttonWidth < 200 ||
    !accountPopover.singleLine ||
    !accountPopover.noOverlap ||
    !result.channelCreated ||
    !result.screenshotAction ||
    !result.expanded ||
    !result.expandedSend.sent ||
    !result.expandedSend.collapsed ||
    !result.expandedSend.placeholderInside ||
    !result.markdownPreview.bold ||
    !result.markdownPreview.task ||
    !result.markdownPreview.code ||
    !result.markdownPreview.copy ||
    !result.dragOverlay ||
    result.attachmentCount < 2 ||
    !result.preview ||
    !result.onlineSections.some((text) => text.includes("在线")) ||
    result.toast ||
    unread.badge !== "1" ||
    !unread.spaceDot ||
    !unread.cleared
  )
    throw new Error(
      `chat UX failed: ${JSON.stringify({ ...result, ...unread })}`,
    );
  if (
    multilineComposer.composerHeight <= 58 ||
    !multilineComposer.contained ||
    multilineComposer.scrollable
  )
    throw new Error(
      `multiline composer failed: ${JSON.stringify(multilineComposer)}`,
    );
  if (
    !longComposer.scrollable ||
    longComposer.height > 121 ||
    longComposer.scrollHeight <= longComposer.clientHeight ||
    longComposer.overflowY !== "auto" ||
    longComposer.maxLength !== 4000
  )
    throw new Error(`long composer failed: ${JSON.stringify(longComposer)}`);
  if (
    historyOverflow.messageCount < 100 ||
    historyOverflow.scrollHeight <= historyOverflow.clientHeight ||
    historyOverflow.overflowY !== "scroll" ||
    !historyOverflow.initialBottom ||
    !historyOverflow.jumpVisible ||
    !historyBrowse.stayedAtTop ||
    !historyBrowse.jumpVisible ||
    !historyBrowse.returnedToLatest
  )
    throw new Error(
      `message history scrolling failed: ${JSON.stringify({ historyOverflow, historyBrowse })}`,
    );
  console.log(
    JSON.stringify({
      chatUx: true,
      screenshotIpc,
      avatarUi,
      accountPopover,
      ...result,
      multilineComposer,
      longComposer,
      historyOverflow,
      historyBrowse,
      unreadBadge: unread.badge,
      spaceUnread: unread.spaceDot,
      unreadCleared: unread.cleared,
    }),
  );
} finally {
  ws?.close();
  child.kill();
  socket.close();
}
