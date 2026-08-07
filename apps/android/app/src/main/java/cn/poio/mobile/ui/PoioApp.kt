package cn.poio.mobile.ui

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.KeyboardVoice
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import cn.poio.mobile.BuildConfig
import cn.poio.mobile.PoioActions
import cn.poio.mobile.data.PoioState
import cn.poio.mobile.model.Channel
import cn.poio.mobile.model.ChannelKind
import cn.poio.mobile.model.ChatMessage
import cn.poio.mobile.model.DirectMessage
import cn.poio.mobile.model.Space
import cn.poio.mobile.model.User
import cn.poio.mobile.voice.VoiceState
import cn.poio.mobile.voice.VoiceDeviceState
import cn.poio.mobile.voice.MicrophoneTestState
import cn.poio.mobile.screen.MediasoupScreenReceiver
import cn.poio.mobile.screen.RemoteScreenTrack
import cn.poio.mobile.screen.ScreenReceiverState
import cn.poio.mobile.screen.ScreenQuality
import cn.poio.mobile.screen.clampScreenPan
import cn.poio.mobile.update.AndroidUpdateInfo
import cn.poio.mobile.update.AndroidUpdateState
import cn.poio.mobile.update.updateProgressPercent
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.webrtc.RendererCommon
import org.webrtc.AudioTrack
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun PoioApp(
    state: PoioState,
    voiceState: VoiceState,
    voiceDeviceState: VoiceDeviceState,
    microphoneTestState: MicrophoneTestState,
    screenState: ScreenReceiverState,
    updateState: AndroidUpdateState,
    actions: PoioActions,
) {
    val context = LocalContext.current
    var pendingVoiceChannel by remember { mutableStateOf<String?>(null) }
    val voicePermissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val channelId = pendingVoiceChannel
        pendingVoiceChannel = null
        val microphoneGranted = grants[Manifest.permission.RECORD_AUDIO] == true
            || ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (microphoneGranted && channelId != null) {
            actions.joinVoice(channelId)
        } else if (channelId != null) {
            actions.showError("加入语音频道需要麦克风权限，请在系统设置中允许 POIO 使用麦克风")
        }
    }
    val joinVoice: (String) -> Unit = { channelId ->
        val required = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(Manifest.permission.BLUETOOTH_CONNECT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = required.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            actions.joinVoice(channelId)
        } else {
            pendingVoiceChannel = channelId
            voicePermissions.launch(missing.toTypedArray())
        }
    }
    val microphoneTestPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) actions.startMicrophoneTest()
        else actions.showError("麦克风测试需要录音权限，请在系统设置中允许 POIO 使用麦克风")
    }
    val startMicrophoneTest = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            actions.startMicrophoneTest()
        } else {
            microphoneTestPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    LaunchedEffect(updateState) {
        if (updateState is AndroidUpdateState.ReadyToInstall) {
            actions.installReadyUpdate()
        }
    }
    when {
        state.connecting && !state.authenticated -> LoadingScreen("正在连接 POIO…")
        !state.authenticated -> AuthScreen(state, actions)
        else -> HomeScreen(
            state,
            voiceState,
            voiceDeviceState,
            microphoneTestState,
            screenState,
            updateState,
            actions,
            joinVoice,
            startMicrophoneTest,
        )
    }
}

@Composable
private fun LoadingScreen(label: String) {
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            PoioWordmark()
            CircularProgressIndicator()
            Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AuthScreen(state: PoioState, actions: PoioActions) {
    var register by rememberSaveable { mutableStateOf(false) }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    Box(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.statusBars.union(WindowInsets.navigationBars)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(28.dp).clip(RoundedCornerShape(26.dp))
                .background(MaterialTheme.colorScheme.surface).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            PoioWordmark()
            Text(if (register) "创建 POIO 账号" else "欢迎回来", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("登录后可与 Windows 客户端进入同一社区。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text("用户名") }, singleLine = true)
            OutlinedTextField(
                password, { password = it }, Modifier.fillMaxWidth(), label = { Text("密码") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { actions.authenticate(username, password, register) }),
            )
            Button(
                onClick = { actions.authenticate(username, password, register) },
                enabled = !state.busy && username.trim().length >= 2 && password.length >= if (register) 8 else 1,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(if (register) "注册并登录" else "登录") }
            TextButton(onClick = { register = !register }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text(if (register) "已有账号？直接登录" else "没有账号？注册")
            }
            if (!state.connected) Text("服务连接已断开，POIO 会自动重试。", color = MaterialTheme.colorScheme.error)
        }
        state.error?.let { ErrorDialog(it, actions::clearError) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScreen(
    state: PoioState,
    voiceState: VoiceState,
    voiceDeviceState: VoiceDeviceState,
    microphoneTestState: MicrophoneTestState,
    screenState: ScreenReceiverState,
    updateState: AndroidUpdateState,
    actions: PoioActions,
    onJoinVoice: (String) -> Unit,
    onStartMicrophoneTest: () -> Unit,
) {
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var spaceDialog by remember { mutableStateOf<SpaceDialog?>(null) }
    var channelDialog by remember { mutableStateOf(false) }
    var settingsDialog by remember { mutableStateOf(false) }
    var accountSheet by remember { mutableStateOf(false) }
    var channelOpen by rememberSaveable { mutableStateOf(false) }
    var pendingVoiceJoin by remember { mutableStateOf<Channel?>(null) }
    var dismissedUpdateVersion by rememberSaveable { mutableStateOf<Int?>(null) }
    var hasConnectedOnce by rememberSaveable { mutableStateOf(state.connected) }
    var connectionWasLost by rememberSaveable { mutableStateOf(false) }
    var showConnectionRestored by remember { mutableStateOf(false) }
    val homeScope = rememberCoroutineScope()
    val startUpdateDownload: (AndroidUpdateInfo) -> Unit = { info ->
        actions.downloadUpdate(info)
        dismissedUpdateVersion = info.versionCode
        homeScope.launch {
            snackbar.showSnackbar("更新已开始下载，完成后会自动校验并打开安装页面")
        }
    }
    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) actions.updateAvatar(uri)
    }
    val leaveSoundPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) actions.updateLeaveSound(uri)
    }
    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); actions.clearError() }
    }
    LaunchedEffect(state.connected) {
        if (state.connected) {
            if (hasConnectedOnce && connectionWasLost) {
                showConnectionRestored = true
                connectionWasLost = false
                delay(2_200)
                showConnectionRestored = false
            }
            hasConnectedOnce = true
        } else {
            showConnectionRestored = false
            if (hasConnectedOnce) connectionWasLost = true
        }
    }
    val openChannel: (Channel) -> Unit = { channel ->
        actions.selectChannel(channel.id)
        if (channel.kind == ChannelKind.VOICE && state.voiceChannelId != channel.id) {
            pendingVoiceJoin = channel
        } else {
            channelOpen = true
        }
    }
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.fillMaxSize()) {
        if (state.directPeer != null) {
            DirectMessageScreen(
                peer = state.directPeer,
                currentUserId = state.user?.id,
                messages = state.directMessages,
                busy = state.busy,
                onBack = actions::closeDirectMessage,
                onSend = actions::sendDirectMessage,
                onAttach = actions::sendDirectAttachment,
                modifier = Modifier.padding(padding),
            )
        } else if (!channelOpen) {
            MobileCommunityScreen(
                state = state,
                voiceState = voiceState,
                onSpace = actions::selectSpace,
                onChannel = openChannel,
                onCreateSpace = { spaceDialog = SpaceDialog.CREATE },
                onJoinSpace = { spaceDialog = SpaceDialog.JOIN },
                onCreateChannel = { channelDialog = true },
                onInvite = actions::createSpaceInvite,
                onSettings = { settingsDialog = true },
                onProfile = { accountSheet = true },
                onDirectMessage = actions::openDirectMessage,
                modifier = Modifier.padding(padding),
            )
        } else {
            val channel = state.selectedChannel
            when {
                channel == null -> EmptyHome(Modifier.padding(padding))
                channel.kind == ChannelKind.TEXT -> Scaffold(
                    modifier = Modifier.padding(padding),
                    topBar = {
                        TopAppBar(
                            title = { Text("# ${channel.name}", fontWeight = FontWeight.Bold) },
                            navigationIcon = {
                                IconButton(onClick = { channelOpen = false }) {
                                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回社区")
                                }
                            },
                            actions = {
                                IconButton(onClick = { settingsDialog = true }) {
                                    Icon(Icons.Default.Settings, "设置")
                                }
                            },
                            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                        )
                    },
                ) { channelPadding ->
                    key(channel.id) {
                    ChatScreen(
                        messages = state.messages,
                        currentUserId = state.user?.id,
                        canModerate = state.selectedSpace?.ownerId == state.user?.id,
                        busy = state.busy,
                        searchResults = state.messageSearchResults,
                        searchBusy = state.messageSearchBusy,
                        onSend = actions::sendMessage,
                        onAttach = actions::sendAttachment,
                        onEdit = actions::editMessage,
                        onDelete = actions::deleteMessage,
                        onReact = actions::reactMessage,
                        onSearch = actions::searchMessages,
                        onClearSearch = actions::clearMessageSearch,
                        modifier = Modifier.padding(channelPadding),
                    )
                }
                }
                else -> VoiceRoom(
                    channel = channel,
                    messages = state.messages,
                    busy = state.busy,
                    serverVersion = state.capabilities?.serverVersion,
                    currentUserId = state.user?.id,
                    canModerate = state.selectedSpace?.ownerId == state.user?.id,
                    members = state.voiceMembers[channel.id].orEmpty(),
                    joined = state.voiceChannelId == channel.id,
                    voiceState = voiceState,
                    screenState = screenState,
                    onScreenQuality = actions::setScreenQuality,
                    onScreenAudio = actions::setScreenAudioEnabled,
                    onRetryScreen = actions::retryScreenReceiver,
                    onJoin = { onJoinVoice(channel.id) },
                    onLeave = actions::leaveVoice,
                    onMute = actions::setMuted,
                    onDeafen = actions::setDeafened,
                    onRoute = actions::selectVoiceRoute,
                    onUserVolume = actions::setUserVolume,
                    onSendMessage = actions::sendMessage,
                    onAttachMessage = actions::sendAttachment,
                    searchResults = state.messageSearchResults,
                    searchBusy = state.messageSearchBusy,
                    onEditMessage = actions::editMessage,
                    onDeleteMessage = actions::deleteMessage,
                    onReactMessage = actions::reactMessage,
                    onSearchMessages = actions::searchMessages,
                    onClearMessageSearch = actions::clearMessageSearch,
                    onBack = { channelOpen = false },
                    onSettings = { settingsDialog = true },
                    modifier = Modifier.padding(padding),
                )
            }
        }
            Column(
                Modifier.align(Alignment.TopCenter)
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                NetworkStatusBanner(
                    connected = state.connected,
                    connecting = state.connecting,
                    restored = showConnectionRestored,
                )
                AndroidUpdateProgressBanner(
                    state = updateState,
                    onInstall = actions::installReadyUpdate,
                )
            }
        }
    }
    spaceDialog?.let { mode -> NameDialog(if (mode == SpaceDialog.CREATE) "创建社区" else "输入邀请码", onDismiss = { spaceDialog = null }) { value ->
        if (mode == SpaceDialog.CREATE) actions.createSpace(value) else actions.joinSpace(value)
        spaceDialog = null
    } }
    if (channelDialog) ChannelDialog(onDismiss = { channelDialog = false }) { name, voice -> actions.createChannel(name, voice); channelDialog = false }
    pendingVoiceJoin?.let { channel ->
        ModalBottomSheet(
            onDismissRequest = { pendingVoiceJoin = null },
            containerColor = Color(0xFF24262D),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 34.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Default.Headset, null, tint = Color.White)
                    Text(channel.name, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Icon(Icons.Default.KeyboardVoice, null, tint = Color(0xFF8E929C))
                }
                Text(
                    if (state.voiceMembers[channel.id].orEmpty().isEmpty()) {
                        "这里好安静啊。只有你一个人吗？\n快点叫小伙伴来开黑啊！"
                    } else {
                        "当前有 ${state.voiceMembers[channel.id].orEmpty().size} 人在语音频道"
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(
                    onClick = {
                        pendingVoiceJoin = null
                        channelOpen = true
                        onJoinVoice(channel.id)
                    },
                    modifier = Modifier.fillMaxWidth().height(58.dp),
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF52E000),
                        contentColor = Color.Black,
                    ),
                ) {
                    Text("加入语音频道", fontWeight = FontWeight.Bold, fontSize = 17.sp)
                }
            }
        }
    }
    if (accountSheet) {
        ModalBottomSheet(
            onDismissRequest = { accountSheet = false },
            containerColor = Color(0xFF24262D),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 34.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                state.user?.let { user ->
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        UserAvatar(user.avatarUrl, user.username, 58.dp)
                        Column(Modifier.weight(1f)) {
                            Text(user.username, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("POIO 账号", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                        }
                    }
                }
                FilledTonalButton(
                    onClick = {
                        accountSheet = false
                        avatarPicker.launch(arrayOf("image/*"))
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Icon(Icons.Default.AccountCircle, null)
                    Spacer(Modifier.width(8.dp))
                    Text("更换头像")
                }
                FilledTonalButton(
                    onClick = {
                        accountSheet = false
                        settingsDialog = true
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Icon(Icons.Default.Settings, null)
                    Spacer(Modifier.width(8.dp))
                    Text("语音设置")
                }
                when (updateState) {
                    is AndroidUpdateState.Available -> FilledTonalButton(
                        onClick = { startUpdateDownload(updateState.info) },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Icon(Icons.Default.Download, null)
                        Spacer(Modifier.width(8.dp))
                        Text("下载更新 ${updateState.info.versionName}")
                    }
                    is AndroidUpdateState.Downloading -> FilledTonalButton(
                        onClick = {},
                        enabled = false,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "正在下载 ${updateState.info.versionName} · ${
                                updateProgressPercent(updateState.downloadedBytes, updateState.totalBytes) ?: 0
                            }%",
                        )
                    }
                    is AndroidUpdateState.Verifying -> FilledTonalButton(
                        onClick = {},
                        enabled = false,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("正在校验安装包")
                    }
                    is AndroidUpdateState.ReadyToInstall -> FilledTonalButton(
                        onClick = actions::installReadyUpdate,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Icon(Icons.Default.Download, null)
                        Spacer(Modifier.width(8.dp))
                        Text("继续安装 ${updateState.info.versionName}")
                    }
                    AndroidUpdateState.Checking -> FilledTonalButton(
                        onClick = {},
                        enabled = false,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("正在检查更新")
                    }
                    AndroidUpdateState.UpToDate -> OutlinedButton(
                        onClick = actions::checkForUpdates,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Text("当前已是最新版 · 再次检查")
                    }
                    is AndroidUpdateState.Failed -> Column(
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            updateState.message,
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 12.sp,
                        )
                        OutlinedButton(
                            onClick = actions::checkForUpdates,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) {
                            Icon(Icons.Default.Refresh, null)
                            Spacer(Modifier.width(8.dp))
                            Text("重新检查更新")
                        }
                    }
                    AndroidUpdateState.Idle -> OutlinedButton(
                        onClick = actions::checkForUpdates,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Text("检查客户端更新")
                    }
                }
                TextButton(
                    onClick = {
                        accountSheet = false
                        actions.logout()
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, null, tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(8.dp))
                    Text("退出登录", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
    state.inviteCode?.let { code ->
        InviteCodeDialog(code = code, onDismiss = actions::clearSpaceInvite)
    }
    if (settingsDialog) {
        VoiceSettingsDialog(
            devices = voiceDeviceState,
            microphoneTestState = microphoneTestState,
            leaveSoundUrl = state.user?.leaveSoundUrl,
            soundBusy = state.busy,
            voiceConnected = voiceState is VoiceState.Connecting ||
                voiceState is VoiceState.Reconnecting ||
                voiceState is VoiceState.Connected,
            onInputRoute = actions::selectInputRoute,
            onStartTest = onStartMicrophoneTest,
            onStopTest = actions::stopMicrophoneTest,
            onTestLeaveSound = actions::testLeaveSound,
            onUploadLeaveSound = { leaveSoundPicker.launch(arrayOf("audio/*")) },
            onRemoveLeaveSound = { actions.updateLeaveSound(null) },
            onDismiss = {
                actions.stopMicrophoneTest()
                settingsDialog = false
            },
        )
    }
    (updateState as? AndroidUpdateState.Available)?.info?.let { info ->
        if (dismissedUpdateVersion != info.versionCode) {
            AlertDialog(
                onDismissRequest = { dismissedUpdateVersion = info.versionCode },
                title = { Text("发现 POIO 新版本") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${info.versionName} · ${formatBytes(info.size)}", fontWeight = FontWeight.Bold)
                        if (info.notes.isNotBlank()) Text(info.notes, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            "下载完成后 POIO 会校验文件大小、SHA-256、包名和版本号，再打开系统安装页面。首次更新可能需要允许安装未知应用。",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp,
                        )
                    }
                },
                confirmButton = {
                    Button(onClick = { startUpdateDownload(info) }) {
                        Icon(Icons.Default.Download, null)
                        Spacer(Modifier.width(6.dp))
                        Text("下载更新")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { dismissedUpdateVersion = info.versionCode }) { Text("稍后") }
                },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MobileCommunityScreen(
    state: PoioState,
    voiceState: VoiceState,
    onSpace: (String) -> Unit,
    onChannel: (Channel) -> Unit,
    onCreateSpace: () -> Unit,
    onJoinSpace: () -> Unit,
    onCreateChannel: () -> Unit,
    onInvite: () -> Unit,
    onSettings: () -> Unit,
    onProfile: () -> Unit,
    onDirectMessage: (User) -> Unit,
    modifier: Modifier = Modifier,
) {
    val space = state.selectedSpace
    var membersOpen by remember { mutableStateOf(false) }
    val currentVoiceChannel = state.voiceChannelId?.let { channelId ->
        state.spaces.asSequence().flatMap { it.channels.asSequence() }.firstOrNull { it.id == channelId }
    }
    Column(
        modifier.fillMaxSize().background(Color(0xFF111315))
            .windowInsetsPadding(WindowInsets.statusBars),
    ) {
        Row(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                Modifier.width(78.dp).fillMaxHeight().background(Color(0xFF0D0F11)).padding(vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    IconButton(
                        onClick = onCreateSpace,
                        modifier = Modifier.size(52.dp).background(Color(0xFF292C32), RoundedCornerShape(18.dp)),
                    ) { Icon(Icons.Default.Add, "创建社区", Modifier.size(30.dp)) }
                }
                items(state.spaces, key = Space::id) { item ->
                    val selected = item.id == space?.id
                    Box(Modifier.fillMaxWidth().height(58.dp), contentAlignment = Alignment.Center) {
                        if (selected) {
                            Box(
                                Modifier.align(Alignment.CenterStart).width(5.dp).height(38.dp)
                                    .background(Color(0xFF52E000), RoundedCornerShape(topEnd = 5.dp, bottomEnd = 5.dp)),
                            )
                        }
                        Box(
                            Modifier.size(50.dp)
                                .clip(RoundedCornerShape(if (selected) 15.dp else 21.dp))
                                .background(if (selected) Color(0xFF6749F5) else Color(0xFF292C32))
                                .clickable { onSpace(item.id) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(item.name.take(1).uppercase(), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                item {
                    IconButton(
                        onClick = onJoinSpace,
                        modifier = Modifier.size(50.dp).background(Color(0xFF292C32), RoundedCornerShape(21.dp)),
                    ) { Icon(Icons.Default.Groups, "加入社区", tint = MaterialTheme.colorScheme.secondary) }
                }
            }
            Column(
                Modifier.weight(1f).fillMaxHeight()
                    .clip(RoundedCornerShape(topStart = 22.dp))
                    .background(Color(0xFF222429)).padding(horizontal = 20.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 22.dp, bottom = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(space?.name ?: "POIO", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(
                            if (state.connected) "在线" else "正在重连",
                            fontSize = 11.sp,
                            color = if (state.connected) Color(0xFF52E000) else MaterialTheme.colorScheme.error,
                        )
                    }
                    IconButton(onClick = onSettings) { Icon(Icons.Default.Menu, "菜单和设置") }
                }
                Button(
                    onClick = onInvite,
                    enabled = space != null,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF17191D),
                        contentColor = Color.White,
                    ),
                ) {
                    Icon(Icons.Default.PersonAdd, null)
                    Spacer(Modifier.width(8.dp))
                    Text("邀请成员")
                }
                FilledTonalButton(
                    onClick = { membersOpen = true },
                    enabled = state.communityMembers.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                ) {
                    Icon(Icons.Default.Groups, null)
                    Spacer(Modifier.width(8.dp))
                    val unreadDirect = state.directConversations.sumOf { it.unreadCount }
                    Text("社区成员 · ${state.communityMembers.size}" + if (unreadDirect > 0) " · ${unreadDirect.coerceAtMost(99)} 条私聊" else "")
                }
                Spacer(Modifier.height(20.dp))
                LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val textChannels = space?.channels.orEmpty().filter { it.kind == ChannelKind.TEXT }
                    val voiceChannels = space?.channels.orEmpty().filter { it.kind == ChannelKind.VOICE }
                    item {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("文字分组", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            IconButton(onClick = onCreateChannel, Modifier.size(34.dp)) { Icon(Icons.Default.Add, "创建频道") }
                        }
                    }
                    items(textChannels, key = Channel::id) { channel ->
                        MobileChannelRow(channel, selected = state.selectedChannelId == channel.id) { onChannel(channel) }
                    }
                    item {
                        Spacer(Modifier.height(8.dp))
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("语音分组", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            IconButton(onClick = onCreateChannel, Modifier.size(34.dp)) { Icon(Icons.Default.Add, "创建频道") }
                        }
                    }
                    items(voiceChannels, key = Channel::id) { channel ->
                        val count = state.voiceMembers[channel.id].orEmpty().size
                        MobileChannelRow(
                            channel = channel,
                            selected = state.selectedChannelId == channel.id,
                            trailing = "$count/25",
                        ) { onChannel(channel) }
                    }
                }
                if (currentVoiceChannel != null && voiceState !is VoiceState.Idle) {
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 10.dp)
                            .clip(RoundedCornerShape(14.dp)).background(Color(0xFF17191D))
                            .clickable { onChannel(currentVoiceChannel) }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.KeyboardVoice, null, tint = Color(0xFF52E000))
                        Spacer(Modifier.width(9.dp))
                        Column(Modifier.weight(1f)) {
                            Text("正在语音", fontSize = 11.sp, color = Color(0xFF52E000))
                            Text(currentVoiceChannel.name, fontWeight = FontWeight.Bold)
                        }
                        Text("返回", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (membersOpen) {
            ModalBottomSheet(onDismissRequest = { membersOpen = false }) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Text("社区成员", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("选择成员发起一对一私聊", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                    Spacer(Modifier.height(4.dp))
                    state.communityMembers.forEach { member ->
                        val self = member.id == state.user?.id
                        val unread = state.directConversations.firstOrNull { it.user.id == member.id }?.unreadCount ?: 0
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
                                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f))
                                .clickable(enabled = !self) {
                                    membersOpen = false
                                    onDirectMessage(member)
                                }.padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            UserAvatar(member.avatarUrl, member.username, 38.dp)
                            Column(Modifier.weight(1f)) {
                                Text(member.username + if (self) "（你）" else "", fontWeight = FontWeight.Bold)
                                Text(
                                    if (member.role == "owner") "社区拥有者" else if (self) "当前账号" else "点击发送私聊",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = 11.sp,
                                )
                            }
                            if (unread > 0) {
                                Text(
                                    if (unread > 99) "99+" else unread.toString(),
                                    Modifier.background(MaterialTheme.colorScheme.error, RoundedCornerShape(12.dp)).padding(horizontal = 8.dp, vertical = 3.dp),
                                    color = MaterialTheme.colorScheme.onError,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            } else if (!self) Icon(Icons.Default.ChatBubbleOutline, "私聊")
                        }
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().background(Color(0xFF303238))
                .windowInsetsPadding(WindowInsets.navigationBars).height(76.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            MobileBottomAction(Icons.Default.Home, "社区", selected = true) {}
            MobileBottomAction(Icons.Default.ChatBubbleOutline, "当前频道", selected = false) {
                state.selectedChannel?.let(onChannel)
            }
            MobileBottomAction(Icons.Default.AccountCircle, "我的", selected = false, onClick = onProfile)
        }
    }
}

@Composable
private fun MobileChannelRow(
    channel: Channel,
    selected: Boolean,
    trailing: String? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .background(if (selected) Color(0xFF303238) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            if (channel.kind == ChannelKind.VOICE) Icons.Default.Headset else Icons.Default.Tag,
            null,
            Modifier.size(20.dp),
        )
        Text(channel.name, Modifier.weight(1f), fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
        trailing?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp) }
    }
}

@Composable
private fun MobileBottomAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Column(
        Modifier.clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(icon, null, tint = if (selected) Color(0xFF52E000) else Color(0xFF9B9EA8))
        Text(label, fontSize = 11.sp, color = if (selected) Color.White else Color(0xFF9B9EA8))
    }
}

@Composable
private fun InviteCodeDialog(code: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("邀请成员") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("把邀请码发给朋友，加入后无需每次重新输入。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(code, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
        },
        confirmButton = {
            Button(onClick = {
                context.getSystemService(android.content.ClipboardManager::class.java)
                    .setPrimaryClip(android.content.ClipData.newPlainText("POIO 邀请码", code))
                onDismiss()
            }) { Text("复制邀请码") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
    )
}

@Composable
private fun VoiceSettingsDialog(
    devices: VoiceDeviceState,
    microphoneTestState: MicrophoneTestState,
    leaveSoundUrl: String?,
    soundBusy: Boolean,
    voiceConnected: Boolean,
    onInputRoute: (Int) -> Unit,
    onStartTest: () -> Unit,
    onStopTest: () -> Unit,
    onTestLeaveSound: () -> Unit,
    onUploadLeaveSound: () -> Unit,
    onRemoveLeaveSound: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("语音设置") },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("退出提示音", fontWeight = FontWeight.Bold)
                Text(
                    if (leaveSoundUrl != null) "已设置自定义退出音；你离开频道时，其他成员会听到它。"
                    else "当前使用 POIO 默认退出音。支持 2 MB 以内、0.1–4 秒的音频文件。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onTestLeaveSound, enabled = !soundBusy, modifier = Modifier.weight(1f)) {
                        Text("试听")
                    }
                    Button(onClick = onUploadLeaveSound, enabled = !soundBusy, modifier = Modifier.weight(1f)) {
                        Text(if (leaveSoundUrl == null) "上传" else "更换")
                    }
                }
                if (leaveSoundUrl != null) {
                    TextButton(onClick = onRemoveLeaveSound, enabled = !soundBusy, modifier = Modifier.fillMaxWidth()) {
                        Text("恢复默认退出音")
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text("输入设备", fontWeight = FontWeight.Bold)
                Text(
                    if (voiceConnected) "切换麦克风前请先挂断语音" else "所选设备会用于麦克风测试和下次语音连接",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                )
                devices.inputRoutes.forEach { route ->
                    if (route.id == devices.selectedInputRouteId) {
                        Button(
                            onClick = { onInputRoute(route.id) },
                            enabled = !voiceConnected,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(route.name) }
                    } else {
                        OutlinedButton(
                            onClick = { onInputRoute(route.id) },
                            enabled = !voiceConnected,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(route.name) }
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text("麦克风测试", fontWeight = FontWeight.Bold)
                when (microphoneTestState) {
                    MicrophoneTestState.Idle -> {
                        LinearProgressIndicator(progress = { 0f }, modifier = Modifier.fillMaxWidth())
                        Button(onClick = onStartTest, enabled = !voiceConnected, modifier = Modifier.fillMaxWidth()) {
                            Text("开始测试")
                        }
                    }
                    is MicrophoneTestState.Testing -> {
                        Text(
                            microphoneTestState.deviceName,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp,
                        )
                        LinearProgressIndicator(
                            progress = { microphoneTestState.level },
                            modifier = Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)),
                        )
                        Text(
                            if (microphoneTestState.level > .03f) "检测到麦克风声音" else "请对着麦克风说话",
                            color = if (microphoneTestState.level > .03f) MaterialTheme.colorScheme.secondary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(onClick = onStopTest, modifier = Modifier.fillMaxWidth()) { Text("停止测试") }
                    }
                    is MicrophoneTestState.Failed -> {
                        Text(microphoneTestState.message, color = MaterialTheme.colorScheme.error)
                        Button(onClick = onStartTest, enabled = !voiceConnected, modifier = Modifier.fillMaxWidth()) {
                            Text("重新测试")
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } },
    )
}

@Composable
private fun CommunityDrawer(
    state: PoioState,
    onSpace: (String) -> Unit,
    onChannel: (String) -> Unit,
    onCreateSpace: () -> Unit,
    onJoinSpace: () -> Unit,
    onCreateChannel: () -> Unit,
    onAvatar: () -> Unit,
    onLogout: () -> Unit,
) {
    Row(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.width(76.dp).fillMaxHeight().background(Color(0xFF101118)).padding(vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item { PoioBadge() }
            items(state.spaces, key = Space::id) { space ->
                val selected = state.selectedSpace?.id == space.id
                Box(
                    Modifier.size(48.dp).clip(RoundedCornerShape(if (selected) 15.dp else 22.dp))
                        .background(if (selected) MaterialTheme.colorScheme.primary else Color(0xFF252833)).clickable { onSpace(space.id) },
                    contentAlignment = Alignment.Center,
                ) { Text(space.name.take(1).uppercase(), fontWeight = FontWeight.Bold) }
            }
            item { IconButton(onClick = onCreateSpace, modifier = Modifier.background(Color(0xFF252833), RoundedCornerShape(22.dp))) { Icon(Icons.Default.Add, "创建社区", tint = MaterialTheme.colorScheme.secondary) } }
        }
        Column(Modifier.weight(1f).fillMaxHeight().padding(18.dp)) {
            Text(state.selectedSpace?.name ?: "社区", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(18.dp))
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                state.selectedSpace?.channels?.let { channels ->
                    item {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("频道", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                            IconButton(onClick = onCreateChannel, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Add, "创建频道") }
                        }
                    }
                    items(channels, key = Channel::id) { channel ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                                .background(if (state.selectedChannel?.id == channel.id) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                                .clickable { onChannel(channel.id) }.padding(horizontal = 11.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(if (channel.kind == ChannelKind.VOICE) Icons.Default.Headset else Icons.Default.Tag, null, Modifier.size(18.dp))
                            Text(channel.name)
                        }
                    }
                }
            }
            state.user?.let { user ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onAvatar).padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    UserAvatar(user.avatarUrl, user.username, 38.dp)
                    Column(Modifier.weight(1f)) {
                        Text(user.username, fontWeight = FontWeight.Bold)
                        Text("更换头像", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            FilledTonalButton(onClick = onJoinSpace, Modifier.fillMaxWidth()) { Icon(Icons.Default.Groups, null); Spacer(Modifier.width(8.dp)); Text("加入社区") }
            TextButton(onClick = onLogout, Modifier.fillMaxWidth()) { Icon(Icons.AutoMirrored.Filled.Logout, null); Spacer(Modifier.width(8.dp)); Text("退出登录") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DirectMessageScreen(
    peer: User,
    currentUserId: String?,
    messages: List<DirectMessage>,
    busy: Boolean,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onAttach: (android.net.Uri, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var body by rememberSaveable(peer.id) { mutableStateOf("") }
    val listState = rememberLazyListState()
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            onAttach(uri, body)
            body = ""
        }
    }
    LaunchedEffect(messages.lastOrNull()?.id) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    Scaffold(
        modifier = modifier.fillMaxSize(),
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        UserAvatar(peer.avatarUrl, peer.username, 36.dp)
                        Column {
                            Text(peer.username, fontWeight = FontWeight.Bold)
                            Text("社区成员私聊 · 仅双方可见", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
                        }
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回社区") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        bottomBar = {
            Row(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)
                    .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                IconButton(
                    onClick = { filePicker.launch(arrayOf("image/*", "application/*", "text/*", "audio/*", "video/*")) },
                    enabled = !busy,
                    modifier = Modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)),
                ) { Icon(Icons.Default.AttachFile, "发送图片或文件") }
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it.take(4000) },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("私聊 ${peer.username}") },
                    maxLines = 5,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        if (body.isNotBlank()) {
                            onSend(body)
                            body = ""
                        }
                    }),
                )
                IconButton(
                    onClick = { onSend(body); body = "" },
                    enabled = body.isNotBlank() && !busy,
                    modifier = Modifier.background(MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp)),
                ) { Icon(Icons.AutoMirrored.Filled.Send, "发送", tint = MaterialTheme.colorScheme.onPrimary) }
            }
        },
    ) { contentPadding ->
        if (messages.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(contentPadding).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    Icons.Default.ChatBubbleOutline,
                    null,
                    Modifier.size(58.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(20.dp)).padding(15.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(14.dp))
                Text("开始与 ${peer.username} 私聊", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("支持文字、图片和最大 50 MB 的文件", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(contentPadding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(messages, key = DirectMessage::id) { message ->
                    DirectMessageCard(message, own = message.senderId == currentUserId)
                }
            }
        }
    }
}

@Composable
private fun DirectMessageCard(message: DirectMessage, own: Boolean) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp))
            .background(if (own) MaterialTheme.colorScheme.primary.copy(alpha = .06f) else Color.Transparent)
            .padding(horizontal = 7.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        UserAvatar(message.avatarUrl, message.username, 36.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(if (own) "你" else message.username, fontWeight = FontWeight.Bold)
                Text(
                    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(message.createdAt)),
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.weight(1f))
                IconButton(
                    onClick = {
                        val text = message.body.takeIf(String::isNotBlank) ?: message.attachmentUrl ?: message.attachmentName.orEmpty()
                        context.getSystemService(ClipboardManager::class.java)
                            .setPrimaryClip(ClipData.newPlainText("POIO 私聊", text))
                        Toast.makeText(context, "消息已复制", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.size(30.dp),
                ) { Icon(Icons.Default.ContentCopy, "复制消息", Modifier.size(17.dp)) }
            }
            if (message.body.isNotBlank()) MarkdownMessage(message.body, Modifier.padding(top = 3.dp))
            val attachmentUrl = message.attachmentUrl?.let(::poioAssetUrl)
            if (attachmentUrl != null && message.attachmentMime?.startsWith("image/") == true) {
                AsyncImage(
                    model = attachmentUrl,
                    contentDescription = message.attachmentName ?: "私聊图片",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 130.dp, max = 320.dp).padding(top = 7.dp)
                        .clip(RoundedCornerShape(12.dp)).background(Color.Black).clickable { uriHandler.openUri(attachmentUrl) },
                )
            } else if (attachmentUrl != null) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 7.dp).clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant).clickable { uriHandler.openUri(attachmentUrl) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(Icons.Default.Download, null, tint = MaterialTheme.colorScheme.secondary)
                    Column(Modifier.weight(1f)) {
                        Text(message.attachmentName ?: "附件", maxLines = 2)
                        message.attachmentSize?.let { Text(formatBytes(it), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatScreen(
    messages: List<ChatMessage>,
    currentUserId: String?,
    canModerate: Boolean,
    busy: Boolean,
    searchResults: List<ChatMessage>,
    searchBusy: Boolean,
    onSend: (String, String?) -> Unit,
    onAttach: (android.net.Uri, String, String?) -> Unit,
    onEdit: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    onReact: (String, String) -> Unit,
    onSearch: (String) -> Unit,
    onClearSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var body by rememberSaveable { mutableStateOf("") }
    var replyingTo by remember { mutableStateOf<ChatMessage?>(null) }
    var editingMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var draftBeforeEdit by remember { mutableStateOf("") }
    var actionMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var searchPerformed by rememberSaveable { mutableStateOf(false) }
    var highlightedMessageId by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    var largestContainerHeightPx by remember { mutableIntStateOf(0) }
    var currentContainerHeightPx by remember { mutableIntStateOf(0) }
    var initialScrollDone by remember { mutableStateOf(false) }
    val nearBottom by remember {
        derivedStateOf {
            val layout = listState.layoutInfo
            layout.totalItemsCount == 0 ||
                (layout.visibleItemsInfo.lastOrNull()?.index ?: 0) >= layout.totalItemsCount - 3
        }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val caption = body
            body = ""
            onAttach(uri, caption, replyingTo?.id)
            replyingTo = null
        }
    }
    LaunchedEffect(messages.lastOrNull()?.id) {
        if (messages.isNotEmpty() && (!initialScrollDone || nearBottom)) {
            listState.animateScrollToItem(messages.size + 1)
        }
        initialScrollDone = true
    }
    val remainingBottomInsetPx = remainingImeInset(
        imeBottomPx = WindowInsets.ime.getBottom(density),
        navigationBottomPx = WindowInsets.navigationBars.getBottom(density),
        largestContainerHeightPx = largestContainerHeightPx,
        currentContainerHeightPx = currentContainerHeightPx,
    )
    val remainingBottomInset = with(density) { remainingBottomInsetPx.toDp() }

    Box(
        modifier
            .fillMaxSize()
            .onSizeChanged { size ->
                currentContainerHeightPx = size.height
                if (size.height > largestContainerHeightPx) {
                    largestContainerHeightPx = size.height
                }
            },
    ) {
        Column(Modifier.fillMaxSize().padding(bottom = remainingBottomInset)) {
        if (searchOpen) {
            Column(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = {
                            searchQuery = it.take(100)
                            searchPerformed = false
                        },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Search, null) },
                        placeholder = { Text("搜索当前频道消息") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = {
                            if (searchQuery.isNotBlank()) {
                                searchPerformed = true
                                onSearch(searchQuery)
                            }
                        }),
                    )
                    IconButton(
                        enabled = searchQuery.isNotBlank() && !searchBusy,
                        onClick = {
                            searchPerformed = true
                            onSearch(searchQuery)
                        },
                    ) {
                        if (searchBusy) CircularProgressIndicator(Modifier.size(19.dp), strokeWidth = 2.dp)
                        else Icon(Icons.AutoMirrored.Filled.Send, "搜索")
                    }
                    IconButton(onClick = {
                        searchOpen = false
                        searchQuery = ""
                        searchPerformed = false
                        onClearSearch()
                    }) { Icon(Icons.Default.Close, "关闭搜索") }
                }
                if (searchResults.isNotEmpty()) {
                    LazyColumn(
                        Modifier.fillMaxWidth().heightIn(max = 220.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        items(searchResults, key = { "search-${it.id}" }) { result ->
                            Row(
                                Modifier.fillMaxWidth().clickable {
                                    val index = messages.indexOfFirst { it.id == result.id }
                                    if (index >= 0) {
                                        highlightedMessageId = result.id
                                        scope.launch { listState.animateScrollToItem(index + 1) }
                                    }
                                    searchOpen = false
                                    onClearSearch()
                                }.padding(horizontal = 12.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(9.dp),
                            ) {
                                UserAvatar(result.avatarUrl, result.username, 30.dp)
                                Column(Modifier.weight(1f)) {
                                    Text(result.username, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                    Text(
                                        result.body.ifBlank { result.attachmentName ?: "附件" },
                                        maxLines = 1,
                                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                        }
                    }
                } else if (searchPerformed && !searchBusy) {
                    Text(
                        "没有找到匹配的消息",
                        Modifier.fillMaxWidth().padding(vertical = 7.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }
        } else {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = { searchOpen = true }) {
                    Icon(Icons.Default.Search, null, Modifier.size(17.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("搜索消息")
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item { Spacer(Modifier.height(12.dp)) }
                items(messages, key = ChatMessage::id) { message ->
                    MessageCard(
                        message = message,
                        currentUserId = currentUserId,
                        highlighted = highlightedMessageId == message.id,
                        onActions = { actionMessage = message },
                        onReact = { emoji -> onReact(message.id, emoji) },
                    )
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
            if (!nearBottom && messages.isNotEmpty()) {
                SmallFloatingActionButton(
                    onClick = { scope.launch { listState.animateScrollToItem(messages.size + 1) } },
                    modifier = Modifier.align(Alignment.BottomEnd).padding(18.dp),
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = Color.White,
                ) {
                    Icon(Icons.Default.ArrowDownward, "返回最新消息")
                }
            }
        }
        (editingMessage ?: replyingTo)?.let { context ->
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(start = 11.dp, end = 4.dp, top = 7.dp, bottom = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    if (editingMessage != null) Icons.Default.Edit else Icons.AutoMirrored.Filled.Reply,
                    null,
                    Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        if (editingMessage != null) "编辑消息" else "回复 ${context.username}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                    )
                    Text(
                        context.body.ifBlank { context.attachmentName ?: "已撤回的消息" },
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.sp,
                    )
                }
                IconButton(onClick = {
                    if (editingMessage != null) body = draftBeforeEdit
                    editingMessage = null
                    replyingTo = null
                }) { Icon(Icons.Default.Close, "取消") }
            }
        }
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(
                onClick = { filePicker.launch(arrayOf("*/*")) },
                enabled = !busy && editingMessage == null,
                modifier = Modifier.size(52.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp)),
            ) { Icon(Icons.Default.AttachFile, "发送图片或文件") }
            OutlinedTextField(
                value = body,
                onValueChange = { if (it.length <= 4000) body = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("发送消息") },
                maxLines = 5,
            )
            IconButton(
                onClick = {
                    val value = body
                    val editing = editingMessage
                    body = ""
                    if (editing != null) {
                        onEdit(editing.id, value)
                        editingMessage = null
                        draftBeforeEdit = ""
                    } else {
                        onSend(value, replyingTo?.id)
                        replyingTo = null
                    }
                },
                enabled = (body.isNotBlank() || editingMessage?.attachmentUrl != null) && !busy,
                modifier = Modifier.size(52.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(16.dp)),
            ) {
                Icon(
                    if (editingMessage != null) Icons.Default.Edit else Icons.AutoMirrored.Filled.Send,
                    if (editingMessage != null) "保存修改" else "发送",
                    tint = Color.White,
                )
            }
        }
    }
    }
    actionMessage?.let { message ->
        MessageActionsSheet(
            message = message,
            own = message.userId == currentUserId,
            canModerate = canModerate,
            onDismiss = { actionMessage = null },
            onReply = {
                replyingTo = message
                editingMessage = null
                actionMessage = null
            },
            onEdit = {
                draftBeforeEdit = body
                body = message.body
                editingMessage = message
                replyingTo = null
                actionMessage = null
            },
            onDelete = {
                onDelete(message.id)
                actionMessage = null
            },
            onReact = { emoji ->
                onReact(message.id, emoji)
                actionMessage = null
            },
            onCopy = {
                val text = messageCopyText(message)
                context.getSystemService(ClipboardManager::class.java)
                    .setPrimaryClip(ClipData.newPlainText("POIO 消息", text))
                Toast.makeText(context, "消息已复制", Toast.LENGTH_SHORT).show()
                actionMessage = null
            },
        )
    }
}

internal fun remainingImeInset(
    imeBottomPx: Int,
    navigationBottomPx: Int,
    largestContainerHeightPx: Int,
    currentContainerHeightPx: Int,
): Int {
    val heightAlreadyAvoided = (largestContainerHeightPx - currentContainerHeightPx).coerceAtLeast(0)
    return (imeBottomPx - heightAlreadyAvoided).coerceAtLeast(navigationBottomPx)
}

@Composable
private fun MessageCard(
    message: ChatMessage,
    currentUserId: String?,
    highlighted: Boolean,
    onActions: () -> Unit,
    onReact: (String) -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    Row(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (highlighted) MaterialTheme.colorScheme.primary.copy(alpha = .16f) else Color.Transparent)
            .padding(horizontal = 7.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        UserAvatar(message.avatarUrl, message.username, 36.dp)
        Column(Modifier.weight(1f)) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text(message.username, fontWeight = FontWeight.Bold)
                Text(DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(message.createdAt)), fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (message.editedAt != null) {
                    Text("已编辑", fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.weight(1f))
                if (!message.deleted) {
                    IconButton(onClick = onActions, modifier = Modifier.size(30.dp)) {
                        Icon(Icons.Default.MoreVert, "消息操作", Modifier.size(18.dp))
                    }
                }
            }
            message.reply?.let { reply ->
                Row(
                    Modifier.fillMaxWidth().padding(top = 5.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .7f))
                        .padding(horizontal = 9.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Reply, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f)) {
                        Text(reply.username, color = MaterialTheme.colorScheme.primary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        Text(
                            if (reply.deleted) "原消息已撤回" else reply.body.ifBlank { reply.attachmentName ?: "附件" },
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp,
                        )
                    }
                }
            }
            if (message.deleted) {
                Row(
                    Modifier.padding(top = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(Icons.Default.Delete, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("消息已撤回", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp, fontStyle = FontStyle.Italic)
                }
                return@Column
            }
            if (message.body.isNotBlank()) MarkdownMessage(message.body, Modifier.padding(top = 3.dp))
            val attachmentUrl = message.attachmentUrl?.let(::poioAssetUrl)
            if (attachmentUrl != null && message.attachmentMime?.startsWith("image/") == true) {
                AsyncImage(
                    model = attachmentUrl,
                    contentDescription = message.attachmentName ?: "聊天图片",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp, max = 320.dp).padding(top = 7.dp)
                        .clip(RoundedCornerShape(12.dp)).background(Color.Black).clickable { uriHandler.openUri(attachmentUrl) },
                )
            } else if (attachmentUrl != null) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 7.dp).clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant).clickable { uriHandler.openUri(attachmentUrl) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(Icons.Default.Download, null, tint = MaterialTheme.colorScheme.secondary)
                    Column(Modifier.weight(1f)) {
                        Text(message.attachmentName ?: "附件", maxLines = 2)
                        message.attachmentSize?.let { Text(formatBytes(it), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
            if (message.reactions.isNotEmpty()) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    message.reactions.take(7).forEach { reaction ->
                        TextButton(
                            onClick = { onReact(reaction.emoji) },
                            modifier = Modifier.height(31.dp)
                                .border(
                                    1.dp,
                                    if (currentUserId in reaction.userIds) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = .35f),
                                    RoundedCornerShape(9.dp),
                                ),
                        ) {
                            Text("${reaction.emoji} ${reaction.count}", fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}

private val messageReactionChoices = listOf("👍", "❤️", "😂", "😮", "😢", "😡", "🎉", "👏", "🔥", "✅", "❌", "👀")

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun MessageActionsSheet(
    message: ChatMessage,
    own: Boolean,
    canModerate: Boolean,
    onDismiss: () -> Unit,
    onReply: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onReact: (String) -> Unit,
    onCopy: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 26.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(message.username, fontWeight = FontWeight.Bold)
            Text(
                message.body.ifBlank { message.attachmentName ?: "附件" },
                maxLines = 2,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
            )
            messageReactionChoices.chunked(6).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    row.forEach { emoji ->
                        IconButton(
                            onClick = { onReact(emoji) },
                            modifier = Modifier.size(45.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)),
                        ) { Text(emoji, fontSize = 20.sp) }
                    }
                }
            }
            FilledTonalButton(onClick = onCopy, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.ContentCopy, null)
                Spacer(Modifier.width(8.dp))
                Text("复制消息")
            }
            FilledTonalButton(onClick = onReply, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Filled.Reply, null)
                Spacer(Modifier.width(8.dp))
                Text("回复")
            }
            if (own) {
                FilledTonalButton(onClick = onEdit, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Edit, null)
                    Spacer(Modifier.width(8.dp))
                    Text("编辑消息")
                }
            }
            if (own || canModerate) {
                TextButton(onClick = onDelete, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(8.dp))
                    Text("撤回消息", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

internal fun messageCopyText(message: ChatMessage): String = message.body.takeIf { it.isNotBlank() }
    ?: message.attachmentUrl
    ?: message.attachmentName
    ?: ""

@Composable
private fun UserAvatar(url: String?, username: String, size: androidx.compose.ui.unit.Dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size * .32f)).background(MaterialTheme.colorScheme.primary),
        contentAlignment = Alignment.Center,
    ) {
        Text(username.take(1).uppercase(), fontWeight = FontWeight.Bold)
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = poioAssetUrl(url),
                contentDescription = "$username 的头像",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

private fun poioAssetUrl(path: String): String =
    if (path.startsWith("http://") || path.startsWith("https://")) path
    else BuildConfig.POIO_SERVER_URL.trimEnd('/') + "/" + path.trimStart('/')

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
    bytes >= 1024L -> "%.1f KB".format(bytes / 1024.0)
    else -> "$bytes B"
}

@Composable
private fun NetworkStatusBanner(
    connected: Boolean,
    connecting: Boolean,
    restored: Boolean,
    modifier: Modifier = Modifier,
) {
    if (connected && !restored) return
    val recovered = connected && restored
    val accent = if (recovered) Color(0xFF5CEB91) else Color(0xFFFFB85C)
    Row(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0xF22B2E35))
            .border(1.dp, accent.copy(alpha = 0.7f), RoundedCornerShape(18.dp))
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(12.dp))
                .background(accent.copy(alpha = 0.13f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (recovered) Icons.Default.CheckCircle else Icons.Default.WifiOff,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(21.dp),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (recovered) "网络已恢复" else "网络连接已断开",
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
            Text(
                when {
                    recovered -> "POIO 已重新连接，频道状态正在同步"
                    connecting -> "正在自动重连，语音会同步恢复"
                    else -> "等待网络恢复，POIO 会自动重试"
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }
        if (!recovered && connecting) {
            CircularProgressIndicator(
                Modifier.size(19.dp),
                color = accent,
                strokeWidth = 2.dp,
            )
        }
    }
}

@Composable
private fun AndroidUpdateProgressBanner(
    state: AndroidUpdateState,
    onInstall: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (state !is AndroidUpdateState.Downloading &&
        state !is AndroidUpdateState.Verifying &&
        state !is AndroidUpdateState.ReadyToInstall
    ) {
        return
    }
    val ready = state is AndroidUpdateState.ReadyToInstall
    Column(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0xF22B2E35))
            .border(
                1.dp,
                if (ready) Color(0xFF52E000) else MaterialTheme.colorScheme.primary.copy(alpha = 0.65f),
                RoundedCornerShape(18.dp),
            )
            .clickable(enabled = ready, onClick = onInstall)
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when (state) {
            is AndroidUpdateState.Downloading -> {
                val percent = updateProgressPercent(state.downloadedBytes, state.totalBytes) ?: 0
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Download, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "正在下载 POIO ${state.info.versionName}",
                        Modifier.weight(1f),
                        fontWeight = FontWeight.Bold,
                    )
                    Text("$percent%", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                }
                LinearProgressIndicator(
                    progress = { percent / 100f },
                    modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)),
                )
                Text(
                    "${formatBytes(state.downloadedBytes)} / ${formatBytes(state.totalBytes)}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                )
            }
            is AndroidUpdateState.Verifying -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Column {
                    Text("下载完成，正在校验安装包", fontWeight = FontWeight.Bold)
                    Text(
                        "正在检查 SHA-256、包名和版本号",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp,
                    )
                }
            }
            is AndroidUpdateState.ReadyToInstall -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Default.Download, null, tint = Color(0xFF52E000))
                Column(Modifier.weight(1f)) {
                    Text("POIO ${state.info.versionName} 已通过校验", fontWeight = FontWeight.Bold)
                    Text("点击继续安装", color = Color(0xFF52E000), fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun VoiceRoom(
    channel: Channel,
    messages: List<ChatMessage>,
    busy: Boolean,
    serverVersion: String?,
    currentUserId: String?,
    canModerate: Boolean,
    members: List<cn.poio.mobile.model.User>,
    joined: Boolean,
    voiceState: VoiceState,
    screenState: ScreenReceiverState,
    onScreenQuality: (ScreenQuality) -> Unit,
    onScreenAudio: (Boolean) -> Unit,
    onRetryScreen: () -> Unit,
    onJoin: () -> Unit,
    onLeave: () -> Unit,
    onMute: (Boolean) -> Unit,
    onDeafen: (Boolean) -> Unit,
    onRoute: (Int) -> Unit,
    onUserVolume: (Int, Int) -> Unit,
    onSendMessage: (String, String?) -> Unit,
    onAttachMessage: (android.net.Uri, String, String?) -> Unit,
    searchResults: List<ChatMessage>,
    searchBusy: Boolean,
    onEditMessage: (String, String) -> Unit,
    onDeleteMessage: (String) -> Unit,
    onReactMessage: (String, String) -> Unit,
    onSearchMessages: (String) -> Unit,
    onClearMessageSearch: () -> Unit,
    onBack: () -> Unit,
    onSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showRoutes by remember { mutableStateOf(false) }
    var showScreen by remember { mutableStateOf(true) }
    var showChat by rememberSaveable(channel.id) { mutableStateOf(false) }
    var volumeTarget by remember { mutableStateOf<Pair<cn.poio.mobile.model.User, Int>?>(null) }
    val connected = voiceState as? VoiceState.Connected
    val hasSharedScreen = (screenState as? ScreenReceiverState.Watching)
        ?.tracks?.any { it.mediaTag == "screen" && it.track is VideoTrack } == true
    LaunchedEffect(hasSharedScreen) {
        if (hasSharedScreen) showScreen = true
    }

    if (showChat) {
        Scaffold(
            modifier = modifier.fillMaxSize(),
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(channel.name, fontWeight = FontWeight.Bold)
                            Text(
                                "语音频道聊天",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 11.sp,
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = { showChat = false }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回语音频道")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Color(0xFF151719),
                    ),
                )
            },
            containerColor = Color(0xFF151719),
            contentWindowInsets = WindowInsets(0),
        ) { chatPadding ->
            ChatScreen(
                messages = messages,
                currentUserId = currentUserId,
                canModerate = canModerate,
                busy = busy,
                searchResults = searchResults,
                searchBusy = searchBusy,
                onSend = onSendMessage,
                onAttach = onAttachMessage,
                onEdit = onEditMessage,
                onDelete = onDeleteMessage,
                onReact = onReactMessage,
                onSearch = onSearchMessages,
                onClearSearch = onClearMessageSearch,
                modifier = Modifier.padding(chatPadding),
            )
        }
        return
    }

    Box(
        modifier.fillMaxSize().background(Color(0xFF151719))
            .windowInsetsPadding(WindowInsets.statusBars),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp).padding(bottom = 155.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回社区") }
                Text("自由模式", Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center, fontWeight = FontWeight.Bold)
                IconButton(onClick = { showChat = true }) {
                    Icon(Icons.Default.ChatBubbleOutline, "频道消息")
                }
                IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "语音设置") }
            }
            Text("语音频道", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.size(46.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFF292C32)),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.Headset, null) }
                Column {
                    Text(channel.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("${members.size}/25 人", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                }
            }
            if (connected != null) {
                LinearProgressIndicator(
                    progress = { connected.micLevel },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    color = Color(0xFF52E000),
                )
                if (connected.focusSuppressed) {
                    Text(
                        "其他应用正在占用通话音频，麦克风和声音已暂时关闭",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            ScreenStage(
                state = screenState,
                members = members,
                expanded = showScreen,
                onExpandedChange = { showScreen = it },
                onQuality = onScreenQuality,
                onAudioEnabled = onScreenAudio,
                onRetry = onRetryScreen,
            )
            if (members.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().height(160.dp).clip(RoundedCornerShape(22.dp))
                        .background(Color(0xFF23252A)),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.Groups, null, Modifier.size(42.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("频道里还没有其他人", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                if (connected != null && members.any { it.id != currentUserId }) {
                    Text(
                        "点击其他成员卡片可调节个人音量（0%–200%）",
                        color = MaterialTheme.colorScheme.secondary,
                        fontSize = 12.sp,
                    )
                }
                members.chunked(2).forEach { rowMembers ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        rowMembers.forEach { member ->
                            val sessionId = connected?.userSessions?.get("ed_${member.id}")
                            val adjustable = sessionId != null && member.id != currentUserId
                            val talking = sessionId?.let { it in connected.talkingSessions } == true
                            val memberCardShape = RoundedCornerShape(20.dp)
                            Column(
                                Modifier.weight(1f)
                                    .then(
                                        if (talking) {
                                            Modifier.border(2.dp, Color(0xFF52E000), memberCardShape)
                                        } else {
                                            Modifier
                                        },
                                    )
                                    .clip(memberCardShape)
                                    .background(if (talking) Color(0xFF203022) else Color(0xFF23252A))
                                    .clickable(enabled = adjustable) {
                                        sessionId?.let { volumeTarget = member to it }
                                    }.padding(16.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(9.dp),
                            ) {
                                UserAvatar(member.avatarUrl, member.username, 58.dp)
                                Text(member.username, maxLines = 1, fontWeight = FontWeight.Bold)
                                when {
                                    member.id == currentUserId -> Text(
                                        "你",
                                        fontSize = 11.sp,
                                        color = Color(0xFF52E000),
                                    )
                                    sessionId != null -> Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Icon(
                                            Icons.AutoMirrored.Filled.VolumeUp,
                                            null,
                                            Modifier.size(14.dp),
                                            tint = if (talking) Color(0xFF52E000) else MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        Text(
                                            if (talking) {
                                                "正在说话 · ${connected.userVolumes[sessionId] ?: 100}%"
                                            } else {
                                                "${connected.userVolumes[sessionId] ?: 100}% · 点击调节"
                                            },
                                            fontSize = 11.sp,
                                            color = if (talking) Color(0xFF52E000) else MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    connected != null -> Text(
                                        "正在同步语音成员…",
                                        fontSize = 10.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        if (rowMembers.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
            serverVersion?.let { Text("POIO $it · Mumble 原生语音", color = MaterialTheme.colorScheme.secondary, fontSize = 12.sp) }
            when (voiceState) {
                is VoiceState.Failed -> {
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                            .background(Color(0xFF2C2023)).padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            "语音频道已断线",
                            color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            voiceState.message,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Button(onClick = onJoin, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.Refresh, null)
                            Spacer(Modifier.width(8.dp))
                            Text("重新加载语音频道")
                        }
                    }
                }
                VoiceState.Connecting -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("正在连接 Mumble… 可在下方强制重新加载")
                }
                is VoiceState.Reconnecting -> Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF25232E)).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("语音连接正在恢复", fontWeight = FontWeight.Bold)
                    }
                    Text(
                        "已自动尝试 ${voiceState.attempt.coerceAtLeast(1)} 次，无需退出频道",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                else -> Unit
            }
        }
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(Color(0xFF090A0B)).windowInsetsPadding(WindowInsets.navigationBars)
                .padding(horizontal = 12.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.Top,
        ) {
            when (voiceState) {
                is VoiceState.Connected -> {
                    MobileVoiceControl(
                        icon = Icons.Default.KeyboardVoice,
                        label = if (voiceState.muted) "开麦" else "闭麦",
                        active = !voiceState.muted,
                    ) { onMute(!voiceState.muted) }
                    MobileVoiceControl(
                        icon = Icons.Default.Headset,
                        label = if (voiceState.deafened) "打开声音" else "静音",
                        active = !voiceState.deafened,
                    ) { onDeafen(!voiceState.deafened) }
                    MobileVoiceControl(Icons.AutoMirrored.Filled.VolumeUp, "输出", active = false) { showRoutes = true }
                    MobileVoiceControl(
                        Icons.Default.DesktopWindows,
                        if (showScreen) "隐藏共享" else "观看共享",
                        active = hasSharedScreen && showScreen,
                        enabled = hasSharedScreen,
                    ) { showScreen = !showScreen }
                    MobileVoiceControl(Icons.Default.PowerSettingsNew, "退出", active = false, danger = true) {
                        onLeave()
                        onBack()
                    }
                }
                VoiceState.Connecting -> {
                    MobileVoiceControl(Icons.Default.Refresh, "重新加载", active = true, onClick = onJoin)
                    MobileVoiceControl(Icons.Default.PowerSettingsNew, "退出", active = false, danger = true) {
                        onLeave()
                        onBack()
                    }
                }
                is VoiceState.Reconnecting -> {
                    MobileVoiceControl(Icons.Default.Refresh, "立即重试", active = true, onClick = onJoin)
                    MobileVoiceControl(Icons.Default.PowerSettingsNew, "退出", active = false, danger = true) {
                        onLeave()
                        onBack()
                    }
                }
                is VoiceState.Failed -> {
                    MobileVoiceControl(Icons.Default.Refresh, "重新加载", active = true, onClick = onJoin)
                    MobileVoiceControl(Icons.Default.PowerSettingsNew, "退出", active = false, danger = true) {
                        onLeave()
                        onBack()
                    }
                }
                VoiceState.Idle -> {
                    MobileVoiceControl(
                        if (joined) Icons.Default.Refresh else Icons.Default.KeyboardVoice,
                        if (joined) "重新加载" else "加入语音",
                        active = true,
                        onClick = onJoin,
                    )
                    MobileVoiceControl(Icons.Default.Close, "返回", active = false, onClick = onBack)
                }
            }
        }
    }
    if (showRoutes && connected != null) {
        AlertDialog(
            onDismissRequest = { showRoutes = false },
            title = { Text("输出设备") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    connected.routes.forEach { route ->
                        if (route.id == connected.selectedRouteId) {
                            Button(
                                onClick = { onRoute(route.id); showRoutes = false },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(route.name) }
                        } else {
                            OutlinedButton(
                                onClick = { onRoute(route.id); showRoutes = false },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(route.name) }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showRoutes = false }) { Text("关闭") } },
        )
    }
    volumeTarget?.let { (member, sessionId) ->
        var volume by remember(sessionId) { mutableStateOf((connected?.userVolumes?.get(sessionId) ?: 100).toFloat()) }
        AlertDialog(
            onDismissRequest = { volumeTarget = null },
            title = { Text("${member.username} 的音量") },
            text = {
                Column {
                    Text("${volume.toInt()}%")
                    Slider(
                        value = volume,
                        onValueChange = { value ->
                            volume = value
                            onUserVolume(sessionId, value.toInt())
                        },
                        valueRange = 0f..200f,
                        steps = 19,
                    )
                }
            },
            confirmButton = { TextButton(onClick = { volumeTarget = null }) { Text("完成") } },
        )
    }
}

@Composable
private fun RowScope.MobileVoiceControl(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean,
    enabled: Boolean = true,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val tint = when {
        danger -> Color(0xFFFF3B30)
        active -> Color(0xFF52E000)
        else -> Color(0xFFD4D6DC)
    }
    Column(
        Modifier.weight(1f).clickable(enabled = enabled, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            Modifier.size(54.dp).clip(RoundedCornerShape(27.dp))
                .background(if (enabled) Color(0xFF292C32) else Color(0xFF1B1D21)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, label, tint = if (enabled) tint else Color(0xFF555861))
        }
        Text(label, fontSize = 10.sp, maxLines = 1, color = if (enabled) Color(0xFFBFC2CA) else Color(0xFF555861))
    }
}

@Composable
private fun ScreenStage(
    state: ScreenReceiverState,
    members: List<User>,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onQuality: (ScreenQuality) -> Unit,
    onAudioEnabled: (Boolean) -> Unit,
    onRetry: () -> Unit,
) {
    when (state) {
        ScreenReceiverState.Idle -> Unit
        ScreenReceiverState.Connecting -> {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
                    .background(Color(0xFF23252A)).padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                Column {
                    Text("正在准备屏幕共享", fontWeight = FontWeight.Bold)
                    Text(
                        "连接成功后会自动显示共享画面",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 12.sp,
                    )
                }
            }
        }
        is ScreenReceiverState.Failed -> {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
                    .background(Color(0xFF2C2023)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Default.DesktopWindows, null, tint = MaterialTheme.colorScheme.error)
                    Text("屏幕共享已断开", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
                }
                Text(
                    state.message,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(8.dp))
                    Text("重新加载屏幕共享")
                }
            }
        }
        is ScreenReceiverState.Watching -> {
            val videos = state.tracks.filter { it.mediaTag == "screen" && it.track is VideoTrack }
            val hasScreenAudio = state.tracks.any {
                it.mediaTag == "screen-audio" && it.track is AudioTrack
            }
            if (videos.isNotEmpty()) {
                Column(
                    Modifier.fillMaxWidth()
                        .border(1.dp, Color(0xFF52E000), RoundedCornerShape(20.dp))
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color(0xFF202522)).padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val firstOwner = screenShareOwnerName(videos.first().userId, members)
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Box(
                            Modifier.size(40.dp).clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF52E000)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Default.DesktopWindows, null, tint = Color(0xFF101510))
                        }
                        Column(Modifier.weight(1f)) {
                            Text("$firstOwner 正在共享屏幕", fontWeight = FontWeight.Bold)
                            Text(
                                if (expanded) "点击画面或按钮进入全屏" else "共享仍在进行，点击立即观看",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 12.sp,
                            )
                        }
                        TextButton(onClick = { onExpandedChange(!expanded) }) {
                            Text(if (expanded) "收起" else "观看")
                        }
                    }
                    if (expanded) {
                        videos.forEach { track ->
                            RemoteScreen(
                                remote = track,
                                ownerName = screenShareOwnerName(track.userId, members),
                                quality = state.quality,
                                onQuality = onQuality,
                                screenAudioAvailable = hasScreenAudio,
                                screenAudioEnabled = state.screenAudioEnabled,
                                onScreenAudioEnabled = onAudioEnabled,
                            )
                        }
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            ScreenQuality.entries.forEach { quality ->
                                val label = screenQualityLabel(quality)
                                if (state.quality == quality) {
                                    Button(
                                        onClick = { onQuality(quality) },
                                        modifier = Modifier.weight(1f),
                                    ) { Text(label, maxLines = 1) }
                                } else {
                                    OutlinedButton(
                                        onClick = { onQuality(quality) },
                                        modifier = Modifier.weight(1f),
                                    ) { Text(label, maxLines = 1) }
                                }
                            }
                        }
                        if (hasScreenAudio) {
                            FilledTonalButton(
                                onClick = { onAudioEnabled(!state.screenAudioEnabled) },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(
                                    if (state.screenAudioEnabled) {
                                        Icons.AutoMirrored.Filled.VolumeUp
                                    } else {
                                        Icons.AutoMirrored.Filled.VolumeOff
                                    },
                                    null,
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    if (state.screenAudioEnabled) {
                                        "共享声音已开启"
                                    } else {
                                        "共享声音已关闭"
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RemoteScreen(
    remote: RemoteScreenTrack,
    ownerName: String,
    quality: ScreenQuality,
    onQuality: (ScreenQuality) -> Unit,
    screenAudioAvailable: Boolean,
    screenAudioEnabled: Boolean,
    onScreenAudioEnabled: (Boolean) -> Unit,
) {
    val videoTrack = remote.track as VideoTrack
    var fullscreen by remember { mutableStateOf(false) }
    val activity = LocalContext.current.findActivity()
    DisposableEffect(fullscreen, activity) {
        if (!fullscreen || activity == null) return@DisposableEffect onDispose { }
        val previousOrientation = activity.requestedOrientation
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose { activity.requestedOrientation = previousOrientation }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("$ownerName 的屏幕", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                if (remote.route == "p2p") "P2P 直连" else "服务器转发",
                fontSize = 10.sp,
                color = if (remote.route == "p2p") Color(0xFF52E000) else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF171A18)).padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        Box(
            Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(14.dp))
                .background(Color.Black).clickable { fullscreen = true },
        ) { WebRtcVideo(videoTrack, Modifier.fillMaxSize()) }
        TextButton(onClick = { fullscreen = true }) { Text("全屏观看") }
    }
    if (fullscreen) {
        Dialog(
            onDismissRequest = { fullscreen = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            FullscreenScreenViewer(
                remote = remote,
                quality = quality,
                onQuality = onQuality,
                screenAudioAvailable = screenAudioAvailable,
                screenAudioEnabled = screenAudioEnabled,
                onScreenAudioEnabled = onScreenAudioEnabled,
                onClose = { fullscreen = false },
            )
        }
    }
}

internal fun screenShareOwnerName(userId: String, members: List<User>): String =
    members.firstOrNull { it.id == userId }?.username?.takeIf { it.isNotBlank() } ?: "频道成员"

@Composable
private fun FullscreenScreenViewer(
    remote: RemoteScreenTrack,
    quality: ScreenQuality,
    onQuality: (ScreenQuality) -> Unit,
    screenAudioAvailable: Boolean,
    screenAudioEnabled: Boolean,
    onScreenAudioEnabled: (Boolean) -> Unit,
    onClose: () -> Unit,
) {
    val videoTrack = remote.track as VideoTrack
    var fillViewport by remember(remote.producerId) { mutableStateOf(false) }
    var scale by remember(remote.producerId) { mutableStateOf(1f) }
    var pan by remember(remote.producerId) { mutableStateOf(Offset.Zero) }
    var viewport by remember(remote.producerId) { mutableStateOf(IntSize.Zero) }
    var controlsVisible by remember(remote.producerId) { mutableStateOf(true) }

    fun resetZoom() {
        scale = 1f
        pan = Offset.Zero
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        ImmersiveDialogEffect()
        WebRtcVideo(
            track = videoTrack,
            scalingType = if (fillViewport) {
                RendererCommon.ScalingType.SCALE_ASPECT_FILL
            } else {
                RendererCommon.ScalingType.SCALE_ASPECT_FIT
            },
            modifier = Modifier.fillMaxSize()
                .onSizeChanged { size ->
                    viewport = size
                    pan = Offset(
                        clampScreenPan(pan.x, size.width, scale),
                        clampScreenPan(pan.y, size.height, scale),
                    )
                }
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = pan.x,
                    translationY = pan.y,
                )
                .pointerInput(remote.producerId) {
                    detectTransformGestures { _, gesturePan, gestureZoom, _ ->
                        val nextScale = (scale * gestureZoom).coerceIn(1f, 4f)
                        scale = nextScale
                        pan = if (nextScale <= 1f) {
                            Offset.Zero
                        } else {
                            Offset(
                                clampScreenPan(pan.x + gesturePan.x, viewport.width, nextScale),
                                clampScreenPan(pan.y + gesturePan.y, viewport.height, nextScale),
                            )
                        }
                    }
                }
                .pointerInput(remote.producerId) {
                    detectTapGestures(
                        onTap = { controlsVisible = !controlsVisible },
                        onDoubleTap = {
                            if (scale > 1.01f) {
                                resetZoom()
                            } else {
                                fillViewport = !fillViewport
                            }
                        },
                    )
                },
        )
        if (controlsVisible) {
            Row(
                Modifier.align(Alignment.TopEnd).padding(18.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(onClick = {
                    resetZoom()
                    fillViewport = !fillViewport
                }) {
                    Text(if (fillViewport) "适配" else "填满")
                }
                Button(onClick = onClose) { Text("退出全屏") }
            }
            Column(
                Modifier.align(Alignment.BottomCenter).padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    if (scale > 1.01f) "缩放 ${"%.1f".format(scale)}× · 双击复位" else "双击切换适配/填满 · 双指缩放",
                    color = Color.White,
                    fontSize = 12.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ScreenQuality.entries.forEach { option ->
                        if (quality == option) {
                            Button(onClick = { onQuality(option) }) { Text(screenQualityLabel(option)) }
                        } else {
                            OutlinedButton(onClick = { onQuality(option) }) { Text(screenQualityLabel(option)) }
                        }
                    }
                }
                if (screenAudioAvailable) {
                    FilledTonalButton(
                        onClick = { onScreenAudioEnabled(!screenAudioEnabled) },
                    ) {
                        Icon(
                            if (screenAudioEnabled) {
                                Icons.AutoMirrored.Filled.VolumeUp
                            } else {
                                Icons.AutoMirrored.Filled.VolumeOff
                            },
                            null,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(if (screenAudioEnabled) "关闭共享声音" else "打开共享声音")
                    }
                }
            }
        }
    }
}

private fun screenQualityLabel(quality: ScreenQuality): String = when (quality) {
    ScreenQuality.AUTO -> "自动"
    ScreenQuality.LOW -> "流畅"
    ScreenQuality.MEDIUM -> "高清"
    ScreenQuality.HIGH -> "原画"
}

@Composable
private fun ImmersiveDialogEffect() {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = (view.parent as? DialogWindowProvider)?.window
        if (window == null) return@DisposableEffect onDispose { }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowCompat.getInsetsController(window, view)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            controller.show(WindowInsetsCompat.Type.systemBars())
            WindowCompat.setDecorFitsSystemWindows(window, true)
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
private fun WebRtcVideo(
    track: VideoTrack,
    modifier: Modifier = Modifier,
    scalingType: RendererCommon.ScalingType = RendererCommon.ScalingType.SCALE_ASPECT_FIT,
) {
    val context = LocalContext.current
    val renderer = remember {
        SurfaceViewRenderer(context).apply {
            init(MediasoupScreenReceiver.eglContext, null)
            setEnableHardwareScaler(true)
        }
    }
    DisposableEffect(track, renderer) {
        track.addSink(renderer)
        onDispose { track.removeSink(renderer) }
    }
    AndroidView(
        factory = { renderer },
        modifier = modifier,
        update = { it.setScalingType(scalingType) },
        onRelease = { it.release() },
    )
}

@Composable private fun EmptyHome(modifier: Modifier = Modifier) = Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("还没有可用频道") }
@Composable private fun PoioWordmark() = Text("POIO", color = MaterialTheme.colorScheme.onSurface, fontSize = 26.sp, fontWeight = FontWeight.Black, fontStyle = FontStyle.Italic)
@Composable private fun PoioBadge() = Box(Modifier.size(46.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) { Text("P", fontWeight = FontWeight.Black, fontStyle = FontStyle.Italic, fontSize = 20.sp) }
@Composable private fun ErrorDialog(message: String, dismiss: () -> Unit) = AlertDialog(onDismissRequest = dismiss, confirmButton = { TextButton(onClick = dismiss) { Text("知道了") } }, title = { Text("POIO") }, text = { Text(message) })

private enum class SpaceDialog { CREATE, JOIN }

@Composable
private fun NameDialog(title: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var value by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(value, { value = it }, label = { Text(if (title.contains("邀请码")) "邀请码" else "社区名称") }, singleLine = true) },
        confirmButton = { Button(onClick = { onConfirm(value) }, enabled = value.isNotBlank()) { Text("确定") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun ChannelDialog(onDismiss: () -> Unit, onConfirm: (String, Boolean) -> Unit) {
    var value by rememberSaveable { mutableStateOf("") }
    var voice by rememberSaveable { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("创建频道") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value, { value = it }, label = { Text("频道名称") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (voice) OutlinedButton(onClick = { voice = false }) { Text("文字频道") } else Button(onClick = { voice = false }) { Text("文字频道") }
                    if (voice) Button(onClick = { voice = true }) { Text("语音频道") } else OutlinedButton(onClick = { voice = true }) { Text("语音频道") }
                }
            }
        },
        confirmButton = { Button(onClick = { onConfirm(value, voice) }, enabled = value.isNotBlank()) { Text("创建") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
