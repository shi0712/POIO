(() => {
  const tokenKey='poio.admin.session';
  const mount=location.pathname.split('/admin')[0].replace(/\/$/,'');
  const apiRoot=`${mount}/api/admin`;
  const $=id=>document.getElementById(id);
  const state={token:localStorage.getItem(tokenKey)||'',admin:null,users:[],total:0,offset:0,limit:50,query:'',target:null,mode:'add'};
  const formatPoints=value=>Math.trunc(Number(value)||0).toLocaleString('zh-CN');
  const formatTime=value=>new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

  async function request(path,options={}){
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(state.token)headers.Authorization=`Bearer ${state.token}`;
    const response=await fetch(`${apiRoot}${path}`,{...options,headers,cache:'no-store'});
    const result=await response.json().catch(()=>({error:'服务器响应格式错误'}));
    if(response.status===401&&path!=='/login'){logout();throw new Error(result.error||'登录已过期');}
    if(!response.ok)throw new Error(result.error||'请求失败');
    return result;
  }
  function busy(button,on,label){button.disabled=on;if(label){button.dataset.label??=button.textContent;button.textContent=on?label:button.dataset.label}}
  function showToast(message){const toast=$('toast');toast.textContent=message;toast.classList.remove('hidden');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.add('hidden'),2600)}
  function showLogin(error=''){state.token='';localStorage.removeItem(tokenKey);$('dashboard').classList.add('hidden');$('loginView').classList.remove('hidden');$('loginError').textContent=error;}
  function showDashboard(){ $('loginView').classList.add('hidden');$('dashboard').classList.remove('hidden');$('adminName').textContent=state.admin.username;$('adminInitial').textContent=state.admin.username.slice(0,1).toUpperCase();loadWallets(); }
  function logout(){const token=state.token;if(token)fetch(`${apiRoot}/logout`,{method:'POST',headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});state.token='';state.admin=null;showLogin();}
  async function resume(){if(!state.token){showLogin();return}try{const result=await request('/me');state.admin=result.user;showDashboard()}catch(error){showLogin(error.message)}}

  function makeUserCell(user){const wrap=document.createElement('div');wrap.className='user-cell';let avatar;if(user.avatarUrl){avatar=document.createElement('img');avatar.src=`${mount}${user.avatarUrl}`;avatar.alt=''}else{avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=user.username.slice(0,1).toUpperCase()}const text=document.createElement('span');const name=document.createElement('b');name.textContent=user.username;const id=document.createElement('small');id.textContent=`ID ${user.id.slice(0,8)}`;text.append(name,id);wrap.append(avatar,text);return wrap}
  function cell(content,className=''){const td=document.createElement('td');if(content instanceof Node)td.append(content);else td.textContent=content;if(className)td.className=className;return td}
  function renderWallets(){const body=$('walletRows');body.replaceChildren();let sum=0;for(const user of state.users){sum+=user.balance;const row=document.createElement('tr');row.append(cell(makeUserCell(user)),cell(formatPoints(user.balance),'points'),cell(formatTime(user.updatedAt)));const action=cell('');const button=document.createElement('button');button.className='adjust-btn';button.textContent='修改积分';button.addEventListener('click',()=>openAdjust(user));action.append(button);row.append(action);body.append(row)}$('emptyWallets').classList.toggle('hidden',state.users.length>0);$('totalUsers').textContent=formatPoints(state.total);$('visiblePoints').textContent=formatPoints(sum);const first=state.total?state.offset+1:0;const last=Math.min(state.offset+state.limit,state.total);$('pageInfo').textContent=`${first}–${last} / ${state.total}`;$('prevPage').disabled=state.offset===0;$('nextPage').disabled=state.offset+state.limit>=state.total}
  async function loadWallets(){try{const params=new URLSearchParams({query:state.query,limit:String(state.limit),offset:String(state.offset)});const result=await request(`/game-wallets?${params}`);state.users=result.users;state.total=result.total;renderWallets()}catch(error){showToast(error.message)}}

  function openAdjust(user){state.target=user;state.mode='add';$('adjustTitle').textContent=`修改 ${user.username} 的积分`;$('targetName').textContent=user.username;$('targetInitial').textContent=user.username.slice(0,1).toUpperCase();$('targetBalance').textContent=formatPoints(user.balance);$('pointValue').value='';$('adjustReason').value='';$('adjustError').textContent='';for(const button of $('modeTabs').querySelectorAll('button'))button.classList.toggle('active',button.dataset.mode==='add');updatePreview();$('adjustModal').classList.remove('hidden');$('pointValue').focus()}
  function closeAdjust(){$('adjustModal').classList.add('hidden');state.target=null}
  function updatePreview(){if(!state.target)return;const raw=Math.abs(Number($('pointValue').value)||0);const next=state.mode==='set'?raw:state.mode==='subtract'?state.target.balance-raw:state.target.balance+raw;const output=$('balancePreview').querySelector('b');output.textContent=Number.isFinite(next)?formatPoints(next):'—';output.className=next<0?'negative':''}
  async function submitAdjust(event){event.preventDefault();if(!state.target)return;const button=$('confirmAdjust');const raw=Math.abs(Number($('pointValue').value));const action=state.mode==='set'?'set':'add';const value=state.mode==='subtract'?-raw:raw;try{busy(button,true,'正在修改…');$('adjustError').textContent='';const result=await request(`/game-wallets/${encodeURIComponent(state.target.id)}`,{method:'POST',body:JSON.stringify({action,value,reason:$('adjustReason').value})});closeAdjust();showToast(`${result.username}：${formatPoints(result.before)} → ${formatPoints(result.after)}`);await loadWallets()}catch(error){$('adjustError').textContent=error.message}finally{busy(button,false)}}

  function renderAudit(entries){const body=$('auditRows');body.replaceChildren();for(const entry of entries){const row=document.createElement('tr');row.append(cell(formatTime(entry.createdAt)),cell(entry.adminUsername),cell(entry.targetUsername),cell(`${entry.amount>0?'+':''}${formatPoints(entry.amount)}`,entry.amount>0?'positive':'negative'),cell(`${formatPoints(entry.balanceBefore)} → ${formatPoints(entry.balanceAfter)}`,'points'),cell(entry.reason,'audit-reason'));body.append(row)}$('emptyAudit').classList.toggle('hidden',entries.length>0)}
  async function loadAudit(){try{const result=await request('/game-audit?limit=100');renderAudit(result.entries)}catch(error){showToast(error.message)}}
  function switchPage(page){for(const button of document.querySelectorAll('.nav-item'))button.classList.toggle('active',button.dataset.page===page);$('walletPage').classList.toggle('hidden',page!=='wallets');$('auditPage').classList.toggle('hidden',page!=='audit');$('pageTitle').textContent=page==='wallets'?'积分管理':'操作记录';if(page==='audit')loadAudit()}

  $('loginForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('loginButton');try{busy(button,true,'正在验证…');$('loginError').textContent='';const result=await request('/login',{method:'POST',body:JSON.stringify({username:$('loginUsername').value,password:$('loginPassword').value})});state.token=result.token;state.admin=result.user;localStorage.setItem(tokenKey,state.token);$('loginPassword').value='';showDashboard()}catch(error){$('loginError').textContent=error.message}finally{busy(button,false)}});
  $('logoutButton').addEventListener('click',logout);
  $('searchForm').addEventListener('submit',event=>{event.preventDefault();state.query=$('searchInput').value.trim();state.offset=0;loadWallets()});
  $('prevPage').addEventListener('click',()=>{state.offset=Math.max(0,state.offset-state.limit);loadWallets()});
  $('nextPage').addEventListener('click',()=>{state.offset+=state.limit;loadWallets()});
  $('closeModal').addEventListener('click',closeAdjust);$('adjustModal').addEventListener('click',event=>{if(event.target===$('adjustModal'))closeAdjust()});
  $('modeTabs').addEventListener('click',event=>{const button=event.target.closest('button[data-mode]');if(!button)return;state.mode=button.dataset.mode;for(const item of $('modeTabs').querySelectorAll('button'))item.classList.toggle('active',item===button);updatePreview()});
  $('pointValue').addEventListener('input',updatePreview);$('adjustForm').addEventListener('submit',submitAdjust);
  for(const button of document.querySelectorAll('.quick-values button'))button.addEventListener('click',()=>{$('pointValue').value=button.dataset.value;updatePreview()});
  for(const button of document.querySelectorAll('.nav-item'))button.addEventListener('click',()=>switchPage(button.dataset.page));
  $('refreshAudit').addEventListener('click',loadAudit);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('adjustModal').classList.contains('hidden'))closeAdjust()});
  resume();
})();
